import { colors } from "@/config/theme"
import { formatBytes } from "@/utils/format"
import { openHtmlDialog } from "@/services/dialog-service"
import renderChangesDialog from "@/eta/dialogs/changes-dialog"
import { ChangesDialogEvent } from "@/controllers/dialog/changes-dialog-controller"

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

  const html = renderChangesDialog({
    title: titleParts.join(" — "),
    dirty: enrichedDirty,
    pending: pendingChanges,
    currentPath,
  })

  const { el: overlay, close } = openHtmlDialog({ html, onClose })

  // Wire the Stimulus controller's events to the requested actions. The controller
  // emits namespaced events (e.g. changes-dialog:discard) instead of a callback registry.
  overlay.addEventListener(ChangesDialogEvent.Discard, (e) => {
    actions.onDiscard((e as CustomEvent<string>).detail)
  })
  overlay.addEventListener(ChangesDialogEvent.DiscardAll, () => actions.onDiscardAll())
  overlay.addEventListener(ChangesDialogEvent.SaveAll, () => actions.onFlushAll())
  overlay.addEventListener(ChangesDialogEvent.Done, () => close())
  overlay.addEventListener(ChangesDialogEvent.Reload, ((e: CustomEvent<{ idx: number; path: string }>) => {
    const { idx, path } = e.detail
    const dialogEl = overlay.querySelector('[data-controller="changes-dialog"]') ?? overlay
    actions.onLoadOriginal(path).then((text) => {
      dialogEl.dispatchEvent(new CustomEvent(ChangesDialogEvent.ReloadReady, {
        detail: { idx, text },
        bubbles: true,
      }))
    })
  }) as EventListener)
}
