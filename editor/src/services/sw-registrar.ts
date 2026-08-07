import type { ModuleRegistry } from "@/services/module-registry"
import { getLoadedChunkNames } from "@/services/module-registry"
import { updaterDiff, isStaleVersion } from "@/eta/updater-core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { appState } from "@/stores/app-state"
import { editorSelfBase, isDev, bootedAppHash, bootedIndexHash, bootedBuildVersion } from "@/config"

const UPDATE_INTERVAL = isDev ? 1_000 : 60 * 60 * 1000

// Payload of the SW_ACTIVATED message: the full asset inventory the SW built,
// so the page can decide between a hot swap (changed non-entry chunks whose
// reverse-dependency closure reaches only swappable controllers) and a reload
// (entry pot / shell / stateful pot changed — see applySwap).
interface ActivationData {
  type: "SW_ACTIVATED"
  version: number
  buildVersion: number
  chunkMap: Record<string, string>
  chunks: string[]
  appHash: string
  indexHash: string
  affectedBy: Record<string, string[]>
  coldOnChange: Record<string, boolean>
}

// Shape of updaterDiff's result (updater-core.ts is @ts-nocheck shared source,
// so its exports carry only weak inferred types — restate them here).
interface HotSwapPlan {
  changed: string[]
  toImport: string[]
  toRemount: string[]
  nameToUrl: Record<string, string>
  idForChunk: Record<string, string>
}
interface UpdaterDiffResult {
  entryChanged: "app" | "shell" | ""
  coldChanged: string | null
  hot: HotSwapPlan | null
}

// Control flags for the self-heal path. After an interrupted update the page
// can keep referencing pruned chunk hashes, so every subsequent refresh trips
// a 404 and wedges the app. When the SW (stale-chunk 404) or the swap logic
// detects it, we reload once; the guard key throttles to a single reload per
// window so a genuinely broken build degrades to an error page instead of a
// reload loop.
const RELOAD_GUARD_KEY = "inb4doc:sw:reload-guard"
const RELOAD_GUARD_MS = 10_000
let reloadQueued = false

// Upgrade-in-progress flag. A reload in the middle of an update boots the stale
// app.js, which then 404s on the chunks the server just pruned — wedging every
// refresh until a fresh build is served. The flag is persisted in sessionStorage
// (survives reloads): it's set when an update starts and cleared once the new
// build fully applies. On a reload that finds the flag still set, the previous
// update never finished, so we show a "please wait" notice and retry the install
// instead of silently booting into the half-updated state.
const UPGRADE_FLAG_KEY = "inb4doc:sw:upgrade-in-progress"

function markUpgradeInProgress(): void {
  try { sessionStorage.setItem(UPGRADE_FLAG_KEY, "1") } catch { /* ignore */ }
}
function clearUpgradeFlag(): void {
  try { sessionStorage.removeItem(UPGRADE_FLAG_KEY) } catch { /* ignore */ }
}
function upgradeFlagged(): boolean {
  try { return sessionStorage.getItem(UPGRADE_FLAG_KEY) === "1" } catch { return false }
}

function forceReload(reason: string): void {
  if (reloadQueued) return
  reloadQueued = true
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    if (Date.now() - last < RELOAD_GUARD_MS) {
      reloadQueued = false
      return
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable (privacy modes) — allow the single reload.
  }
  console.warn("[SW] self-heal reload:", reason)
  location.reload()
}

function onSWInstall(sw: ServiceWorker): void {
  // An update is in flight from here until the new build is applied.
  markUpgradeInProgress()
  if (navigator.serviceWorker.controller) {
    appEvents.emit(AppEvent.UpdateAvailable)
  }

  sw.addEventListener("statechange", () => {
    if (sw.state === "installed" && navigator.serviceWorker.controller) {
      appEvents.emit(AppEvent.SWUpdateReady)
    }
  })
}

export function registerSW(registry: ModuleRegistry): void {
  if (!("serviceWorker" in navigator)) {
    console.info("[SW] ServiceWorker API not available")
    return
  }

  // Desktop/mobile webviews and file:// pages use protocols (app://, file://,
  // …) where ServiceWorker registration is unsupported. SW updates are only
  // meaningful over http(s), where the bundle is served fresh on each load.
  if (!["http:", "https:"].includes(location.protocol)) {
    console.info("[SW] Skipping registration — unsupported protocol:", location.protocol)
    return
  }

  // A flag left from a PREVIOUS load means that update never finished. Read and
  // reset it before any install this boot can set it again, otherwise a normal
  // update would be mistaken for an interrupted one and show a wait notice.
  const leftoverUpgrade = upgradeFlagged()
  clearUpgradeFlag()

  let appliedVersion: number | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let pendingVersion: number | null = null
  let pendingData: ActivationData | null = null
  // applySwap serialization: one activation applies at a time. A newer
  // activation that arrives while a swap is in flight is queued (newest kept)
  // and applied when the in-flight swap finishes — the ongoing update is never
  // cancelled or overlapped, which would otherwise let the next build prune the
  // chunk the current swap is still importing.
  let applying = false
  let queuedActivation: ActivationData | null = null

  const basename = (url: string): string => url.split("/").pop() ?? url

  // A change that a hot swap cannot apply: dev reloads immediately; deployed
  // builds ask the user (the Ok-action toast in update-controller) instead of
  // yanking the page mid-edit.
  const requestReload = (reason: string): void => {
    if (isDev) {
      forceReload(reason)
      return
    }
    appEvents.emit(AppEvent.UpdateRequiresReload, { reason })
  }

  // Rotated css chunks (styles-*, eta-*, node_imports-*.css) are swapped in
  // place: update the <link> href to the new file. Links injected by
  // linkEmittedCss have no query, and a matching stem with a different hash is
  // the only case touched — same-build activations are no-ops, and structural
  // link changes are caught by indexHash instead.
  const swapCssLink = (url: string): void => {
    const name = basename(url)
    const m = name.match(/^(.*?)(-[a-f0-9]+)?\.css$/)
    if (!m) return
    const stem = m[1]
    for (const link of Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    )) {
      const base = (link.href.split("/").pop() ?? "").split("?")[0]
      const hm = base.match(/^(.*?)(-[a-f0-9]+)?\.css$/)
      if (hm && hm[1] === stem && base !== name) {
        link.setAttribute("href", url)
      }
    }
  }

  const applySwap = async (data: ActivationData) => {
    const { version, buildVersion, chunks } = data

    // A page booted from the same build generation this activation carries
    // already has that generation's index.html — any hash mismatch is rebuild
    // churn (the SW sampled assets mid-burst), not a real entry/shell change, so
    // the reload checks below are skipped. A real entry/shell change always
    // ships a newer buildVersion marker and still reloads.
    const sameGeneration =
      bootedBuildVersion !== "" &&
      buildVersion !== undefined &&
      String(buildVersion) === bootedBuildVersion

    // The manifest classification lives in the shared updater core
    // (templates/partials/updater-core.eta, compiled to src/eta/updater-core.ts
    // — the same source the SW's transports reuse). It returns a reload (entry
    // pot app.js + __farm_runtime.js, or shell index.html, or a cold chunk
    // changed), a hot swap (re-import + remount sets), or a no-op (nothing new).
    const { entryChanged, coldChanged, hot } = updaterDiff(data, {
      loadedNames: getLoadedChunkNames(),
      bootedAppHash,
      bootedIndexHash,
      sameGeneration,
    }) as unknown as UpdaterDiffResult

    if (entryChanged) {
      return requestReload(entryChanged === "shell" ? "shell changed" : "entry changed")
    }

    // Rotated css chunks apply hot (link href swap), no reload needed. Done
    // before the cold/no-op returns so a css-only build still hot-swaps its
    // stylesheet.
    for (const url of chunks ?? []) {
      if (url.endsWith(".css")) swapCssLink(url)
    }

    if (coldChanged) {
      return requestReload(`cold chunk: ${coldChanged}`)
    }
    if (!hot) {
      appliedVersion = version
      clearUpgradeFlag()
      return
    }

    // Hot: re-import every affected chunk's new modules and remount the
    // controllers in the reverse-dependency closure so their factories (and the
    // services they require) re-execute.
    const remounted = await registry.swap(
      hot.toImport,
      hot.toRemount,
      (name) => hot.nameToUrl[name],
      (name) => hot.idForChunk[name]
    )
    // Only the shell's ModulesSwapped → loadSidebar chain re-renders a swapped
    // controller, so it must fire after a real remount. A no-op activation
    // (every chunk baseline-skipped, or already applied) would otherwise
    // trigger a needless sidebar reload on every startup.
    if (remounted.length > 0) {
      appEvents.emit(AppEvent.ModulesSwapped, { names: remounted })
    }
    appliedVersion = version
    clearUpgradeFlag()
  }

  // Debounced entry for an SW_ACTIVATED payload. A rebuild burst fires several
  // activations in quick succession (oldest first); instead of applying each,
  // settle for a moment and hand only the newest version seen to the serialized
  // apply. A newer activation that lands mid-settle replaces the pending one,
  // so a burst coalesces into a single apply and no chunk is imported twice.
  const scheduleApply = (data: ActivationData): void => {
    if (isStaleVersion(data.version, appliedVersion)) return
    if (pendingVersion !== null && data.version <= pendingVersion) return
    pendingVersion = data.version
    pendingData = data
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      const d = pendingData
      pendingVersion = null
      pendingData = null
      if (!d) return
      // registry.swap() unloads the controller identifier, disconnecting an
      // open dialog mid-interaction. Hold the swap until the dialog closes.
      if (appState.get("dialog")) {
        settleTimer = setTimeout(() => {
          settleTimer = null
          runApplySwap(d)
        }, 500)
        return
      }
      runApplySwap(d)
    }, 1000)
  }

  // Serialized apply. Only one swap runs at a time: while one is in flight,
  // newer activations queue (only the newest is kept — dedupe) and apply once
  // it finishes. At release time, an activation still settling supersedes one
  // already queued, so a burst that spans the in-flight swap still collapses to
  // the single newest build instead of applying every intermediate version.
  const runApplySwap = (data: ActivationData): void => {
    if (isStaleVersion(data.version, appliedVersion)) return
    if (applying) {
      if (!queuedActivation || data.version > queuedActivation.version) {
        queuedActivation = data
      }
      return
    }
    applying = true
    applySwap(data).catch((err) => {
      console.error("[SW] apply failed:", err)
    }).finally(() => {
      applying = false
      const next =
        queuedActivation && (!pendingData || queuedActivation.version > pendingData.version)
          ? queuedActivation
          : pendingData
      queuedActivation = null
      pendingVersion = null
      pendingData = null
      if (next) runApplySwap(next)
    })
  }

  // The SW lives next to the page (public/sw.js), which may sit under a
  // subpath on the live site. Register relative to the editor base — never
  // root-absolute — so the scope stays confined to the editor.
  const swUrl = new URL(
    "sw.js",
    new URL(editorSelfBase, location.href)
  ).href
  navigator.serviceWorker.register(swUrl).then((r) => {
    console.info("[SW] registered — active:", !!r.active, "waiting:", !!r.waiting, "installing:", !!r.installing)

    // updatefound may have already fired before .then() — check now
    if (r.installing) {
      onSWInstall(r.installing)
    } else if (r.waiting && navigator.serviceWorker.controller) {
      // Update already downloaded while page was closed
      appEvents.emit(AppEvent.UpdateAvailable)
      appEvents.emit(AppEvent.SWUpdateReady)
    }

    r.addEventListener("updatefound", () => {
      const sw = r.installing
      if (sw) onSWInstall(sw)
    })

    // update() fetches sw.js and rejects while offline (or on a server
    // hiccup), surfacing as an "encountered an error during installation"
    // console spam on every visibilitychange/interval tick. Skip the check
    // while offline and swallow any rejection — the next online check retries.
    const checkForUpdates = () => {
      if (!navigator.onLine) return Promise.resolve()
      return r.update().catch(() => {})
    }

    // Periodic background check
    setInterval(checkForUpdates, UPDATE_INTERVAL)

    // Check when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdates()
    })

    // A previous load left an unfinished update: retry the install so it
    // finishes (the normal SW_ACTIVATED path applies it, clears the flag, and
    // the progress/apply events dismiss the notice). If the update is already
    // moot — nothing left installing or waiting — stop waiting right away. No
    // artificial timer: a real slow install keeps the notice alive via progress
    // events, and a moot one resolves immediately.
    if (leftoverUpgrade) {
      appEvents.emit(AppEvent.SWUpdatePending)
      checkForUpdates().then(() => {
        if (!r.installing && !r.waiting) {
          appEvents.emit(AppEvent.SWUpdateResolved)
        }
      })
    }
  }).catch((err) => {
    console.error("[SW] registration failed:", err)
  })

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data
    if (!data) return

    if (data.type === "SW_STALE_ASSET") {
      // A non-IMPORTANT js/css request 404'd in the SW: the page is running a
      // build whose chunks were pruned server-side (interrupted update). Reload
      // once so the current app.js + chunk map take over.
      forceReload("stale chunk: " + data.url)
    } else if (data.type === "SW_INSTALL_PROGRESS") {
      appEvents.emit(AppEvent.SWInstallProgress, { loaded: data.loaded, total: data.total, done: data.done })
    } else if (data.type === "SW_ACTIVATED") {
      const payload = data as ActivationData
      if (typeof payload.version !== "number") return
      scheduleApply(payload)
    }
  })

  // If a controller chunk fails to swap (missing/failed fetch), the update is
  // broken and would wedge on the next refresh too — reload to the current
  // build instead of limping along with a half-applied update. Exception: a
  // swap fails precisely when the build it belongs to was superseded mid-apply
  // and its chunk got pruned by a newer build. If a newer activation is queued
  // or still settling, let it take over — force-reloading now would burn the
  // reload-guard window and boot into the same half-updated state.
  appEvents.on(AppEvent.SWSwapFailed, ({ name }) => {
    if (queuedActivation || pendingData) return
    forceReload("swap failed: " + name)
  })
}
