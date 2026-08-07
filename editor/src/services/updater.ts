import type { ModuleRegistry } from "@/services/module-registry"
import { getLoadedChunkNames } from "@/services/module-registry"
import { updaterDiff, updaterTransfer, isStaleVersion } from "@/eta/updater-core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { updateBase, isDev, bootedAppHash, bootedIndexHash, bootedBuildVersion } from "@/config"

// Part C.1 fetch updater transport (GuiDesktop thin shell). Where the Service
// Worker owns updates over http(s), the desktop/mobile WebViews (app://, file://)
// have no SW — this service polls the remote manifest, downloads the live editor
// into the native data dir via the updater bridge, and hot-swaps or reloads.
// It reuses the shared Part C core (updaterDiff / updaterTransfer / isStaleVersion
// from src/eta/updater-core.ts) and mirrors sw-registrar's serialized, never-
// overlapping apply: an update landing mid-swap queues (newest kept) instead of
// cancelling the in-flight one.

// Poll cadence. Dev builds are excluded (see startUpdater), so this is a real
// desktop-app cadence; visibilitychange catches an update that landed while the
// window was hidden.
const UPDATE_INTERVAL = 30 * 60 * 1000

// The fetch updater reloads on entry/shell/cold changes (a swap can never apply
// those). Same guard key as sw-registrar so the two transports share one
// throttle per window and can't double-reload each other.
const RELOAD_GUARD_KEY = "inb4doc:sw:reload-guard"
const RELOAD_GUARD_MS = 10_000

// Storage backend interface — the fetch twin of the SW's cacheStorage backend.
// The GuiDesktop transport wraps window.saucer.exposed.updaterPut/updaterSizeOf/
// updaterHas (gui bridge, Part C.1 W3). A missing bridge degrades to a console
// notice, never a crash.
export interface UpdaterStorage {
  sizeOf(url: string): Promise<number>
  put(url: string, response: Response): Promise<void>
  has(url: string): Promise<boolean>
}

// Shape of the remote assets/manifest.json emitted by lib/build.ts.
interface RemoteManifest {
  buildVersion: number
  appHash: string
  indexHash: string
  affectedBy: Record<string, string[]>
  coldOnChange: Record<string, boolean>
  important: string[]
  chunks: string[]
  chunkMap: Record<string, string>
}

// updater-core.ts is @ts-nocheck shared source; restate the result shapes here
// (same as sw-registrar).
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

let reloadQueued = false

function forceReload(reason: string): boolean {
  if (reloadQueued) return false
  reloadQueued = true
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    if (Date.now() - last < RELOAD_GUARD_MS) {
      reloadQueued = false
      return false
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable — allow the single reload.
  }
  console.warn("[updater] reload:", reason)
  // Prefer the native bridge reload (the whole window reloads as one unit);
  // fall back to location.reload.
  const nativeReload = (window as any).saucer?.exposed?.reload as (() => void) | undefined
  if (typeof nativeReload === "function") {
    try { nativeReload() } catch { location.reload() }
  } else {
    location.reload()
  }
  return true
}

function basename(url: string): string {
  return url.split("/").pop() ?? url
}

// Rotated css pots apply in place: point the matching <link> at the new file.
// Document-guarded so the transport loop stays unit-testable in node.
function swapCssLink(url: string): void {
  if (typeof document === "undefined") return
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

// The manifest paths are site-absolute (e.g. "/assets/x.js"); resolve them
// against the remote base for the fetch, and against the local origin for the
// swap (the app:// data-dir copy the native bridge serves — Part C.1 W3).
function remoteUrl(path: string): string {
  if (/^https?:/.test(path)) return path
  return `${updateBase}${path.startsWith("/") ? "" : "/"}${path}`
}
function localUrlForChunk(name: string): string {
  // Android WebView (GuiMobile): the bundled editor lives under
  // file:///android_asset/editor/ and shouldInterceptRequest serves the
  // updater's data-dir copy at the same path (data dir first) — location.origin
  // of a file:// page is unreliable, so pin the known mount.
  if ((window as any).NativeBridge) {
    return `file:///android_asset/editor/assets/${name}`
  }
  return `${location.origin}/assets/${name}`
}

interface BridgeEnvelope {
  ok: boolean
  status?: number
  error?: string
  data?: unknown
}

async function callUpdaterBridge(fn: string, ...args: unknown[]): Promise<BridgeEnvelope> {
  const exposed = (window as any).saucer?.exposed as
    | Record<string, (...a: unknown[]) => Promise<string>>
    | undefined
  const caller = exposed?.[fn]
  if (typeof caller !== "function") {
    throw new Error(`Native updater bridge "${fn}" is unavailable`)
  }
  const raw = await caller(...args)
  let env: BridgeEnvelope
  try {
    env = JSON.parse(raw)
  } catch {
    throw new Error(`Native updater bridge "${fn}" returned invalid data`)
  }
  if (!env.ok) {
    throw new Error(env.error ?? `Native updater bridge "${fn}" failed`)
  }
  return env
}

async function responseToBase64(response: Response): Promise<string> {
  const buf = new Uint8Array(await response.arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

// The bridge stores under the data-dir editor root keyed by the path the app://
// scheme serves (e.g. "assets/x.js"), so strip the remote base off the URL. The
// manifest's first `important` entry is the site root ("/") — that's index.html:
// store it under the "index.html" key so the scheme serves the downloaded shell
// (with the remote's app-hash/index-hash metas) on the reload instead of the
// shipped one, which would otherwise never match the manifest and reload forever.
function pathForUrl(url: string): string {
  const base = updateBase.replace(/\/+$/, "")
  if (url.startsWith(base + "/")) {
    const rel = url.slice(base.length + 1)
    return rel || "index.html"
  }
  return basename(url) || "index.html"
}

function createDesktopStorage(): UpdaterStorage | null {
  const exposed = (window as any).saucer?.exposed as
    | Record<string, unknown>
    | undefined
  if (
    !exposed ||
    typeof exposed.updaterPut !== "function" ||
    typeof exposed.updaterSizeOf !== "function" ||
    typeof exposed.updaterHas !== "function"
  ) {
    return null
  }
  return {
    async has(url) {
      const env = await callUpdaterBridge("updaterHas", pathForUrl(url))
      return env.data === true
    },
    async sizeOf(url) {
      const env = await callUpdaterBridge("updaterSizeOf", pathForUrl(url))
      return Number(env.data ?? 0) || 0
    },
    async put(url, response) {
      const b64 = await responseToBase64(response)
      await callUpdaterBridge("updaterPut", pathForUrl(url), b64)
    },
  }
}

// Classify a remote manifest against the running page and apply it:
//   "reload" — entry/shell/cold change: everything is transferred into the data
//              dir first (so the reload boots a complete editor), then reload.
//   "hot"    — swappable: transfer, remount the affected controllers from the
//              data dir, emit ModulesSwapped.
//   "none"   — nothing new (or everything already stored).
// The whole manifest set (important + chunks) is the transfer list; skipCached
// keeps steady-state transfers to genuinely new files, and a first run needs the
// full editor in the data dir regardless.
export async function applyRemoteUpdate(
  manifest: RemoteManifest,
  deps: { storage: UpdaterStorage; registry: ModuleRegistry }
): Promise<"reload" | "hot" | "none"> {
  const { storage, registry } = deps
  const { chunks = [], important = [], buildVersion } = manifest

  const sameGeneration =
    bootedBuildVersion !== "" &&
    buildVersion !== undefined &&
    String(buildVersion) === bootedBuildVersion

  const { entryChanged, coldChanged, hot } = updaterDiff(manifest, {
    loadedNames: getLoadedChunkNames(),
    bootedAppHash,
    bootedIndexHash,
    sameGeneration,
  }) as unknown as UpdaterDiffResult

  if (!entryChanged && !coldChanged && !hot) return "none"

  const urls = [...important, ...chunks].map((p) => remoteUrl(p))
  const stored = await Promise.all(
    urls.map(async (u) => ((await storage.has(u)) ? u : null))
  )
  const precached = new Set(stored.filter((u): u is string => u !== null))
  if (urls.some((u) => !precached.has(u))) {
    appEvents.emit(AppEvent.UpdateAvailable)
  }
  await updaterTransfer(urls, {
    storage,
    precached,
    skipCached: true,
    onProgress: (loaded: number, total: number, done: boolean) =>
      appEvents.emit(AppEvent.SWInstallProgress, { loaded, total, done }),
  })

  if (entryChanged || coldChanged) {
    forceReload(
      entryChanged === "shell"
        ? "shell changed"
        : entryChanged === "app"
          ? "entry changed"
          : `cold chunk: ${coldChanged}`
    )
    return "reload"
  }
  if (!hot) return "none"

  for (const url of chunks) {
    if (url.endsWith(".css")) swapCssLink(localUrlForChunk(basename(url)))
  }

  // The page already has everything in the data dir: apply the new controllers
  // by re-importing from the local origin (nameToUrl remapped) — never by
  // fetching from the remote, which a slow/failed network could wedge.
  appEvents.emit(AppEvent.SWUpdateReady)
  const remounted = await registry.swap(
    hot.toImport,
    hot.toRemount,
    (name) => localUrlForChunk(name),
    (name) => hot.idForChunk[name]
  )
  if (remounted.length > 0) {
    appEvents.emit(AppEvent.ModulesSwapped, { names: remounted })
  }
  return "hot"
}

// Entry point. Self-gates: the fetch transport only runs when the SW transport
// isn't (non-http(s) origin), UPDATE_BASE is set, and this isn't a dev build.
export function startUpdater(registry: ModuleRegistry): void {
  if (["http:", "https:"].includes(location.protocol)) {
    console.info("[updater] Skipping — ServiceWorker transport handles http(s)")
    return
  }
  if (!updateBase) {
    console.info("[updater] No update-base meta — fetch updater disabled")
    return
  }
  if (isDev) {
    console.info("[updater] Skipping — dev build")
    return
  }

  const storage = createDesktopStorage()
  if (!storage) {
    // No native bridge yet: the app still boots from the shipped shell, but
    // nothing can be stored. Notice only, never crash.
    console.warn("[updater] UPDATE_BASE set but no native updater bridge — updates disabled")
    return
  }

  // Serialized apply: one manifest applies at a time; a newer one arriving
  // mid-swap queues (newest kept) and applies when the in-flight update finishes
  // — never cancels or overlaps it (the same invariant the SW registrar holds).
  let applying = false
  let queued: RemoteManifest | null = null
  let appliedBuildVersion: number | null = null

  const runApply = (data: RemoteManifest): void => {
    if (isStaleVersion(data.buildVersion, appliedBuildVersion)) return
    if (applying) {
      if (!queued || data.buildVersion > queued.buildVersion) queued = data
      return
    }
    applying = true
    applyRemoteUpdate(data, { storage, registry })
      .catch((err) => console.error("[updater] apply failed:", err))
      .finally(() => {
        applying = false
        if (typeof data.buildVersion === "number") {
          appliedBuildVersion = data.buildVersion
        }
        const next = queued
        queued = null
        if (next) runApply(next)
      })
  }

  let inFlight = false
  const check = async (): Promise<void> => {
    if (applying || inFlight) return
    inFlight = true
    try {
      const res = await fetch(`${updateBase}/assets/manifest.json`, { cache: "no-store" })
      if (!res.ok) return
      const manifest = (await res.json()) as RemoteManifest
      if (!manifest || typeof manifest.buildVersion !== "number") return
      runApply(manifest)
    } catch (err) {
      console.warn("[updater] manifest check failed:", err)
    } finally {
      inFlight = false
    }
  }

  // Check immediately (a populated-but-behind data dir should catch up fast),
  // then on the interval and when the window becomes visible again.
  check()
  setInterval(check, UPDATE_INTERVAL)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
}
