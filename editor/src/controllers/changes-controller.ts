import { colors } from "@/config/theme"
import { formatBytes } from "@/utils/format"
import { PendingOpType } from "@/entities/PendingOps"
import { BaseDialogController } from "./dialog/base-dialog-controller"
import { openDialog } from "@/services/dialog-service"
import * as icons from "@/eta/icons"
import { renderScreen } from "@/eta/views/screen"
import { renderPendingDiff } from "@/components/ui/pending-diff"
import { appEvents, AppEvent } from "@/stores/app-events"
import { changesScreenStore } from "@/stores/changes-screen-store"
import renderChangesDialog from "@/eta/views/dialog/changes-dialog"
import renderChangesRows from "@/eta/views/changes-rows"
import renderChangesScreen from "@/eta/views/controller/changes-screen"

export const ChangesEvent = {
  Approve: "changes:approve",
  Reject: "changes:reject",
  DiscardAll: "changes:discardAll",
  SaveAll: "changes:saveAll",
  Done: "changes:done",
  Reload: "changes:reload",
  ReloadReady: "changes:reload-ready",
} as const

export interface ChangesDialogItem {
  path: string
  label: string
  currentPath?: boolean
  size?: number
  sizeStr?: string
  sizeColor?: string
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

export function enrichChangesItems(items: ChangesDialogItem[]): ChangesDialogItem[] {
  return items.map((c) => {
    if (c.size === undefined) return { ...c }
    const size = c.size
    return {
      ...c,
      sizeStr: formatBytes(size),
      sizeColor: size > 0 ? colors.green : size < 0 ? colors.danger : colors.teal,
    }
  })
}

// One controller per feature: registered as `changes`, it renders the desktop
// dialog when the element carries a payload (dialog-service mounts
// data-changes-payload-value) and the mobile fullview screen otherwise.
export default class ChangesController extends BaseDialogController {
  static targets = ["header", "changeItem", "preview"]
  static values = { payload: Object }

  declare headerTarget: HTMLElement
  declare readonly changeItemTargets: HTMLElement[]
  declare readonly previewTargets: HTMLElement[]

  declare payloadValue: {
    title: string
    items: ChangesDialogItem[]
    currentPath?: string
  }

  // Stimulus generates this runtime getter from `static values`; the shipped
  // types don't (dialogs always carried a payload before the merge).
  declare readonly hasPayloadValue: boolean

  private screenItems: ChangesDialogItem[] = []

  connect(): void {
    if (!this.hasPayloadValue) {
      this.load()
      return
    }
    this.element.innerHTML = renderChangesDialog({
      title: this.payloadValue.title,
      rows: renderChangesRows(this.payloadValue),
    })
    // The opener (facade) dispatches reload-ready on this element after it
    // has fetched the original content for a preview.
    this.element.addEventListener(ChangesEvent.ReloadReady, ((e: CustomEvent<{ idx: number; text: string }>) => {
      this.reloadReady(e)
    }) as EventListener)
  }

  /** Called by the view controller when the fullview screen is activated. */
  load(): void {
    const data = changesScreenStore.get()
    this.screenItems = data?.items ?? []
    const title = `Pending Changes (${this.screenItems.length})`
    this.element.innerHTML = renderChangesScreen({
      title,
      icons: icons as Record<string, string>,
      renderScreen,
      rows: renderChangesRows({ items: this.screenItems }),
    })
  }

  private itemAt(idx: number): ChangesDialogItem | undefined {
    return this.hasPayloadValue ? this.payloadValue.items[idx] : this.screenItems[idx]
  }

  togglePreview(e: Event) {
    const idx = (e.currentTarget as HTMLElement).dataset.idx
    if (idx === undefined) return
    const preview = this.previewTargets[parseInt(idx)]
    if (!preview) return
    const isOpen = preview.style.display === "block"
    preview.style.display = isOpen ? "none" : "block"

    if (!isOpen && !preview.hasChildNodes()) {
      this.loadPreview(parseInt(idx))
    }
  }

  loadPreview(idx: number) {
    const data = this.itemAt(idx)
    if (!data) return

    if (data.notice) {
      const preview = this.previewTargets[idx]
      if (preview) {
        preview.innerHTML = `<div style="padding:8px 10px;color:#856404;background:#fff8e1;font-size:0.85rem">${data.notice}</div>`
      }
      return
    }

    if (!data.path) return
    if (this.hasPayloadValue) {
      this.dispatch("reload", { detail: { idx, path: data.path }, bubbles: true })
      return
    }
    const actions = changesScreenStore.get()?.actions
    if (!actions) return
    void actions.onLoadOriginal(data.path).then((text) => {
      this.reloadReady({ detail: { idx, text } } as CustomEvent<{ idx: number; text: string }>)
    })
  }

  reloadReady(e: Event) {
    const { idx, text } = (e as CustomEvent<{ idx: number; text: string }>).detail
    const preview = this.previewTargets[idx]
    const data = this.itemAt(idx)
    if (!preview || !data) return

    preview.innerHTML = renderPendingDiff(text, data.md ?? "")
  }

  approve(e: Event) {
    const path = (e.currentTarget as HTMLElement).dataset.opPath
    if (!path) return
    if (this.hasPayloadValue) {
      this.dispatch("approve", { detail: path, bubbles: true })
    } else {
      changesScreenStore.get()?.actions.onApprove(path)
    }
    this.removeRow((e.currentTarget as HTMLElement).closest(".inb4doc-changes-item"))
  }

  reject(e: Event) {
    const path = (e.currentTarget as HTMLElement).dataset.discardPath
    if (!path) return
    if (this.hasPayloadValue) {
      this.dispatch("reject", { detail: path, bubbles: true })
    } else {
      changesScreenStore.get()?.actions.onReject(path)
    }
    this.removeRow((e.currentTarget as HTMLElement).closest(".inb4doc-changes-item"))
  }

  private removeRow(item: Element | null) {
    if (!item) return
    item.remove()
    const remaining = this.changeItemTargets.length
    this.headerTarget.textContent = `Pending changes (${remaining})`
    if (remaining === 0) {
      if (this.hasPayloadValue) {
        this.dispatch("done", { bubbles: true })
      } else {
        appEvents.emit(AppEvent.ViewChanged, { view: "more" })
      }
    }
  }

  saveAll() {
    if (this.hasPayloadValue) {
      this.dispatch("saveAll", { bubbles: true })
      this.dispatch("done", { bubbles: true })
      return
    }
    changesScreenStore.get()?.actions.onFlushAll()
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  discardAll() {
    if (this.hasPayloadValue) {
      this.dispatch("discardAll", { bubbles: true })
      this.dispatch("done", { bubbles: true })
      return
    }
    changesScreenStore.get()?.actions.onDiscardAll()
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  close() {
    if (this.hasPayloadValue) {
      this.dispatch("done", { bubbles: true })
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }
}

/** Dialog facade — used by the shell's desktop path. */
export function openChangesDialog(
  items: ChangesDialogItem[],
  currentPath: string,
  actions: ChangesDialogActions,
  onClose: () => void
) {
  const handle = openDialog("changes", {
    title: `Pending changes (${items.length})`,
    items: enrichChangesItems(items),
    currentPath,
  }, {
    onClose,
    listeners: {
      [ChangesEvent.Approve]: ((e: CustomEvent<string>) => {
        actions.onApprove(e.detail)
      }) as EventListener,
      [ChangesEvent.Reject]: ((e: CustomEvent<string>) => {
        actions.onReject(e.detail)
      }) as EventListener,
      [ChangesEvent.DiscardAll]: () => actions.onDiscardAll(),
      [ChangesEvent.SaveAll]: () => actions.onFlushAll(),
      [ChangesEvent.Done]: () => handle.close(),
      [ChangesEvent.Reload]: ((e: CustomEvent<{ idx: number; path: string }>) => {
        const { idx, path } = e.detail
        const dialogEl = handle.overlay.querySelector('[data-controller="changes"]') ?? handle.overlay
        actions.onLoadOriginal(path).then((text) => {
          dialogEl.dispatchEvent(new CustomEvent(ChangesEvent.ReloadReady, {
            detail: { idx, text },
            bubbles: true,
          }))
        })
      }) as EventListener,
    },
  })
}
