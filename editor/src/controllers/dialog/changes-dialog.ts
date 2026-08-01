import { colors } from "@/config/theme"
import { formatBytes } from "@/utils/format"
import { openDialog } from "@/services/dialog-service"
import { PendingOpType } from "@/entities/PendingOps"
import { ChangesDialogEvent } from "./changes-dialog-controller"

export interface ChangesDialogItem {
  path: string
  label: string
  currentPath?: boolean
  size?: number
  md?: string
  notice?: string
  kind: PendingOpType
}

export interface ChangesDialogActions {
  onApprove: (path: string) => void
  onReject: (path: string) => void
  onLoadOriginal: (path: string) => Promise<string>
  onFlushAll: () => void
  onDiscardAll: () => void
}

export function openChangesDialog(
  items: ChangesDialogItem[],
  currentPath: string,
  actions: ChangesDialogActions,
  onClose: () => void
) {
  const enriched = items.map((c) => {
    const size = c.size ?? 0
    return {
      ...c,
      sizeStr: formatBytes(size),
      sizeColor: size > 0 ? colors.green : size < 0 ? colors.danger : colors.teal,
    }
  })

  const handle = openDialog("changes-dialog", {
    title: `Pending changes (${items.length})`,
    items: enriched,
    currentPath,
  }, {
    onClose,
    listeners: {
      [ChangesDialogEvent.Approve]: ((e: CustomEvent<string>) => {
        actions.onApprove(e.detail)
      }) as EventListener,
      [ChangesDialogEvent.Reject]: ((e: CustomEvent<string>) => {
        actions.onReject(e.detail)
      }) as EventListener,
      [ChangesDialogEvent.DiscardAll]: () => actions.onDiscardAll(),
      [ChangesDialogEvent.SaveAll]: () => actions.onFlushAll(),
      [ChangesDialogEvent.Done]: () => handle.close(),
      [ChangesDialogEvent.Reload]: ((e: CustomEvent<{ idx: number; path: string }>) => {
        const { idx, path } = e.detail
        const dialogEl = handle.overlay.querySelector('[data-controller="changes-dialog"]') ?? handle.overlay
        actions.onLoadOriginal(path).then((text) => {
          dialogEl.dispatchEvent(new CustomEvent(ChangesDialogEvent.ReloadReady, {
            detail: { idx, text },
            bubbles: true,
          }))
        })
      }) as EventListener,
    },
  })
}
