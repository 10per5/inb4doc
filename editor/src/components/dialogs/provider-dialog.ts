import { getAvailableProviders } from "@/stores/provider-store"
import { connectionStore } from "@/stores/connection-store"
import type { ProviderType } from "@/providers/index"
import { openHtmlDialog } from "@/services/dialog-service"
import renderProviderDialog from "@/eta/dialogs/provider-dialog"
import { ProviderDialogEvent } from "@/controllers/dialog/provider-dialog-controller"

export interface ProviderDialogResult {
  type: ProviderType
  configChanged: boolean
}

export async function openProviderDialog(
  currentProvider: string,
): Promise<ProviderDialogResult | null> {
  const providers = await getAvailableProviders()
  await connectionStore.probe()

  let selectedType: ProviderType | null = currentProvider as ProviderType
  const conn = connectionStore.getConfig()
  const origHost = conn.host
  const origPort = conn.port

  const badges: Record<string, { icon: string; label: string }> = {
    remote: { icon: "☁️", label: "Server (Remote)" },
    filesystem: { icon: "💻", label: "Local Files" },
    localStorage: { icon: "🗄️", label: "Browser Storage" },
  }

  const currentInfo = badges[currentProvider] || { icon: "❓", label: currentProvider }

  return new Promise<ProviderDialogResult | null>((resolve) => {
    let currentOverlay: HTMLElement | null = null

    function render() {
      if (currentOverlay) {
        currentOverlay.remove()
      }

      const remoteAvailable = connectionStore.remoteAvailable
      const inGuiMode = connectionStore.isInsideAppGui()
      const configuredHost = connectionStore.getHost()
      const remoteAppFallback = inGuiMode
        ? !remoteAvailable
        : configuredHost === "app://" || configuredHost === "app://_" || configuredHost.startsWith("app://_/")
      const remoteGuiFallback = !remoteAvailable && !remoteAppFallback && inGuiMode
      const remoteReason = !remoteAvailable
        ? remoteAppFallback
          ? "inb4doc app://_/ endpoint is used"
          : remoteGuiFallback
            ? "ℹ️ Not reachable: local API is used"
            : "Server not reachable — enter host/port and wait"
        : undefined

      const mergedProviders = providers.map((p) => ({
        ...p,
        available: p.type === "remote" ? remoteAvailable || remoteAppFallback || remoteGuiFallback : p.available,
        reason: p.type === "remote" ? remoteReason : p.reason,
      }))

      const initialStatusClass = remoteAvailable ? "ok"
        : (remoteAppFallback || remoteGuiFallback) ? "info"
        : inGuiMode ? "" : "err"
      const initialStatusText = remoteAvailable ? "✓ Online"
        : (remoteAppFallback || remoteGuiFallback) ? "ℹ️ inb4doc-gui local API is used"
        : inGuiMode ? "" : "Server unreachable"

      const html = renderProviderDialog({
        currentInfo,
        providers: mergedProviders,
        selectedType,
        currentProvider,
        badges,
        conn,
        initialStatusClass,
        initialStatusText,
      })

      const { el: overlay, close } = openHtmlDialog({ html })
      currentOverlay = overlay

      overlay.addEventListener(ProviderDialogEvent.Select, ((e: CustomEvent<string>) => {
        selectedType = e.detail as ProviderType
        close()
        render()
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Probe, ((e: CustomEvent<{ host: string; port: number }>) => {
        const { host, port } = e.detail
        if (host === "app://" || host === "app://_" || host.startsWith("app://_/")) {
          close()
          render()
          return
        }
        connectionStore.setConfig(host, port)
        connectionStore.probe().then(() => {
          close()
          render()
        })
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Accept, ((e: CustomEvent<string>) => {
        const cur = connectionStore.getConfig()
        const configChanged = cur.host !== origHost || cur.port !== origPort
        close()
        resolve({ type: e.detail as ProviderType, configChanged })
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Cancel, () => {
        close()
        resolve(null)
      })
    }

    render()
  })
}
