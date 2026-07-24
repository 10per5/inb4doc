import { getAvailableProviders } from "@/stores/provider-store"
import { connectionStore } from "@/stores/connection-store"
import { ProviderType } from "@/providers/index"
import { openHtmlDialog } from "@/services/dialog-service"
import renderProviderDialog from "@/eta/dialogs/provider-dialog"
import { ProviderDialogEvent } from "@/controllers/dialog/provider-dialog-controller"

export interface ProviderDialogResult {
  type: ProviderType
  configChanged: boolean
}

export async function openProviderDialog(
  currentProvider: ProviderType,
): Promise<ProviderDialogResult | null> {
  const providers = await getAvailableProviders()

  let selectedType: ProviderType | null = currentProvider
  const conn = connectionStore.getConfig()
  const origHost = conn.host
  const origPort = conn.port

  const badges: Record<ProviderType, { icon: string; label: string }> = {
    [ProviderType.Remote]: { icon: "☁️", label: "Server (Remote)" },
    [ProviderType.Mount]: { icon: "📦", label: "Mounted (GUI)" },
    [ProviderType.Filesystem]: { icon: "💻", label: "Local Files" },
    [ProviderType.LocalStorage]: { icon: "🗄️", label: "Browser Storage" },
  }

  const currentInfo = badges[currentProvider] ?? { icon: "❓", label: String(currentProvider) }

  return new Promise<ProviderDialogResult | null>((resolve) => {
    let currentOverlay: HTMLElement | null = null

    function render() {
      if (currentOverlay) {
        currentOverlay.remove()
      }

      const remoteAvailable = connectionStore.remoteAvailable
      const initialStatusClass = remoteAvailable ? "ok" : "err"
      const initialStatusText = remoteAvailable ? "✓ Online" : "Server unreachable"

      const html = renderProviderDialog({
        ProviderType,
        currentInfo,
        providers,
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
        selectedType = Number(e.detail) as ProviderType;
        close()
        render()
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Probe, ((e: CustomEvent<{ host: string; port: number }>) => {
        const { host, port } = e.detail
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
        resolve({ type: Number(e.detail) as ProviderType, configChanged })
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Cancel, () => {
        close()
        resolve(null)
      })
    }

    render()
  })
}
