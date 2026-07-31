import { colors } from "@/config/theme"
import { formatBytes } from "@/utils/format"
import { openDialog } from "@/services/dialog-service"
import { ChangesDialogEvent } from "./changes-dialog-controller"

export interface ChangesDialogData {
  path?: string
  currentPath?: boolean
  md?: string
  changeSize?: number
}

export interface PendingOpData {
  opLabel: string
}

export interface ChangesDialogActions {
  onDiscard: (path: string) => void
  onLoadOriginal: (path: string) => Promise<string>
  onFlushAll: () => void
  onDiscardAll: () => void
}

export function openChangesDialog(
  dirtyChanges: ChangesDialogData[],
  pendingChanges: PendingOpData[],
  currentPath: string,
  actions: ChangesDialogActions,
  onClose: () => void
) {
  const enrichedDirty = dirtyChanges.map(c => {
    const size = c.changeSize ?? 0
    return {
      ...c,
      sizeStr: formatBytes(size),
      sizeColor: size > 0 ? colors.green : size < 0 ? colors.danger : colors.teal,
    }
  })

  const titleParts = [`Unsaved Changes (${dirtyChanges.length})`]
  if (pendingChanges.length > 0) titleParts.push(`Pending Ops (${pendingChanges.length})`)

  const handle = openDialog("changes-dialog", {
    title: titleParts.join(" — "),
    dirty: enrichedDirty,
    pending: pendingChanges,
    currentPath,
  }, {
    onClose,
    listeners: {
      // The controller emits namespaced events (e.g. changes-dialog:discard)
      // instead of a callback registry.
      [ChangesDialogEvent.Discard]: ((e: CustomEvent<string>) => {
        actions.onDiscard(e.detail)
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
