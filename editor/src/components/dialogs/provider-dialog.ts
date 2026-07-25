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
  const origConn = connectionStore.getConfig()

  const badges: Record<ProviderType, { icon: string; label: string }> = {
    [ProviderType.Remote]: { icon: "☁️", label: "Server (Remote)" },
    [ProviderType.Mount]: { icon: "📦", label: "Mounted (GUI)" },
    [ProviderType.Filesystem]: { icon: "💻", label: "Local Files" },
    [ProviderType.LocalStorage]: { icon: "🗄️", label: "Browser Storage" },
  }

  const currentInfo = badges[currentProvider] ?? { icon: "❓", label: String(currentProvider) }

  return new Promise<ProviderDialogResult | null>((resolve) => {
    let currentOverlay: HTMLElement | null = null
    let remoteAvailable = connectionStore.remoteAvailable
    let hasProbed = false

    function updateAcceptBtn() {
      if (!currentOverlay) return
      const btn = currentOverlay.querySelector(".inb4doc-btn-success") as HTMLButtonElement | null
      if (!btn) return
      const isRemote = selectedType === ProviderType.Remote
      btn.disabled = selectedType == null || (isRemote && !remoteAvailable)
    }

    function updateProbeStatus() {
      if (!currentOverlay) return
      const el = currentOverlay.querySelector(".remote-status")
      if (!el) return
      el.textContent = remoteAvailable ? "✓ Online" : "Server unreachable"
      el.className = "remote-status " + (remoteAvailable ? "ok" : "err")
    }

    function doProbe(host: string, port: number) {
      remoteAvailable = false
      updateAcceptBtn()
      connectionStore.setConfig(host, port)
      connectionStore.probe().then(() => {
        hasProbed = true
        remoteAvailable = connectionStore.remoteAvailable
        updateProbeStatus()
        updateAcceptBtn()
      })
    }

    function render() {
      if (currentOverlay) {
        currentOverlay.remove()
      }

      const conn = connectionStore.getConfig()
      remoteAvailable = connectionStore.remoteAvailable
      const initialStatusClass = hasProbed ? (remoteAvailable ? "ok" : "err") : ""
      const initialStatusText = hasProbed ? (remoteAvailable ? "✓ Online" : "Server unreachable") : "Server status unknown"

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
        canAccept: selectedType != null && (selectedType !== ProviderType.Remote || remoteAvailable),
      })

      const { el: overlay, close } = openHtmlDialog({ html })
      currentOverlay = overlay

      overlay.addEventListener(ProviderDialogEvent.Select, ((e: CustomEvent<string>) => {
        selectedType = Number(e.detail) as ProviderType;
        close()
        render()
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Probe, ((e: CustomEvent<{ host: string; port: number }>) => {
        doProbe(e.detail.host, e.detail.port)
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Accept, ((e: CustomEvent<string>) => {
        const cur = connectionStore.getConfig()
        const configChanged = cur.host !== origConn.host || cur.port !== origConn.port
        close()
        resolve({ type: Number(e.detail) as ProviderType, configChanged })
      }) as EventListener)

      overlay.addEventListener(ProviderDialogEvent.Cancel, () => {
        close()
        resolve(null)
      })

      if (selectedType === ProviderType.Remote) {
        doProbe(conn.host, conn.port)
      }
    }

    render()
  })
}
