import { getAvailableProviders } from "@/stores/provider-store"
import { connectionStore } from "@/stores/connection-store"
import { ProviderType } from "@/providers/index"
import { openDialog } from "@/services/dialog-service"
import { ProviderDialogEvent } from "./provider-dialog-controller"
import { cloud, packageIcon, laptop, database, helpCircle, infoCircle, warningCircle } from "@/eta/icons"

export interface ProviderDialogResult {
  type: ProviderType
  configChanged: boolean
}

export async function openProviderDialog(
  currentProvider: ProviderType,
): Promise<ProviderDialogResult | null> {
  const providers = await getAvailableProviders()

  const badges: Record<ProviderType, { icon: string; label: string }> = {
    [ProviderType.Remote]: { icon: cloud, label: "Server (Remote)" },
    [ProviderType.Mount]: { icon: packageIcon, label: "Mounted (GUI)" },
    [ProviderType.Filesystem]: { icon: laptop, label: "Local Files" },
    [ProviderType.LocalStorage]: { icon: database, label: "Browser Storage" },
  }

  const currentInfo = badges[currentProvider] ?? { icon: helpCircle, label: String(currentProvider) }
  const origConn = connectionStore.getConfig()

  const handle = openDialog<ProviderDialogResult>("provider-dialog", {
    currentProvider,
    currentInfo,
    providers,
    badges,
    icons: { infoCircle, warningCircle },
  }, {
    listeners: {
      [ProviderDialogEvent.Probe]: ((e: CustomEvent<{ host: string; port: number }>) => {
        const { host, port } = e.detail
        connectionStore.setConfig(host, port)
        connectionStore.probe().then(() => {
          const wrapper = handle.overlay.querySelector('[data-controller="provider-dialog"]') ?? handle.overlay
          wrapper.dispatchEvent(new CustomEvent(ProviderDialogEvent.ProbeResult, {
            detail: { remoteAvailable: connectionStore.remoteAvailable },
            bubbles: true,
          }))
        })
      }) as EventListener,
      [ProviderDialogEvent.Accept]: ((e: CustomEvent<string>) => {
        const cur = connectionStore.getConfig()
        const configChanged = cur.host !== origConn.host || cur.port !== origConn.port
        handle.close({ type: Number(e.detail) as ProviderType, configChanged })
      }) as EventListener,
      [ProviderDialogEvent.Cancel]: () => handle.close(),
    },
  })

  return handle.promise
}
