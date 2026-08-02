import type { ModuleRegistry } from "@/services/module-registry"
import { appEvents, AppEvent } from "@/stores/app-events"
import { appState } from "@/stores/app-state"
import { editorSelfBase, isDev } from "@/config"

const UPDATE_INTERVAL = isDev ? 1_000 : 60 * 60 * 1000

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
  let pendingChunkMap: Record<string, string> | null = null

  const applySwap = async (version: number, map: Record<string, string>) => {
    const names = Object.keys(map)
    if (names.length > 0) {
      const remounted = await registry.swap(names, version, map)
      // Only the shell's ModulesSwapped → loadSidebar chain re-renders a
      // swapped controller, so it must fire after a real remount. A no-op
      // activation (every chunk baseline-skipped, or already applied) would
      // otherwise trigger a needless sidebar reload on every startup.
      if (remounted.length > 0) {
        appEvents.emit(AppEvent.ModulesSwapped, { names: remounted })
      }
    }
    appliedVersion = version
    clearUpgradeFlag()
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
      const { version, chunkMap } = data
      if (typeof version !== "number") return
      // Never apply a build older than one already applied. (buildVersion is
      // seeded from the previous sw.js on disk, so it stays monotonic across
      // dev-server restarts.)
      if (appliedVersion !== null && version <= appliedVersion) return
      // A rebuild burst — or a reload controlled by a still-stale SW — can fire
      // several activations in quick succession, oldest first. Applying the
      // first one would swap a STALE chunkMap back in and regress the page.
      // Settle for a moment and apply only the newest version seen.
      if (pendingVersion !== null && version <= pendingVersion) return
      pendingVersion = version
      pendingChunkMap = chunkMap
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(async () => {
        settleTimer = null
        const v = pendingVersion
        const map = pendingChunkMap
        if (map === null || v === null) return
        // registry.swap() unloads the controller identifier, disconnecting an
        // open dialog mid-interaction. Hold the swap until the dialog closes.
        if (appState.get("dialog")) {
          settleTimer = setTimeout(() => {
            settleTimer = null
            pendingVersion = null
            pendingChunkMap = null
            applySwap(v, map)
          }, 500)
          return
        }
        pendingVersion = null
        pendingChunkMap = null
        applySwap(v, map)
      }, 1000)
    }
  })

  // If a controller chunk fails to swap (missing/failed fetch), the update is
  // broken and would wedge on the next refresh too — reload to the current
  // build instead of limping along with a half-applied update.
  appEvents.on(AppEvent.SWSwapFailed, ({ name }) => {
    forceReload("swap failed: " + name)
  })
}
