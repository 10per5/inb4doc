import type { ModuleRegistry } from "@/services/module-registry"
import { appEvents, AppEvent } from "@/stores/app-events"
import { appState } from "@/stores/app-state"
import { editorSelfBase, isDev } from "@/config"

const UPDATE_INTERVAL = isDev ? 1_000 : 60 * 60 * 1000

function onSWInstall(sw: ServiceWorker): void {
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

    // Periodic background check
    setInterval(() => r.update(), UPDATE_INTERVAL)

    // Check when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") r.update()
    })
  }).catch((err) => {
    console.error("[SW] registration failed:", err)
  })

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data
    if (!data) return

    if (data.type === "SW_INSTALL_PROGRESS") {
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
}
