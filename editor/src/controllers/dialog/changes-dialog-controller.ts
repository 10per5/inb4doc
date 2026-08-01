import { renderPendingDiff } from "@/components/ui/pending-diff"
import { PendingOpType } from "@/entities/PendingOps"
import { BaseDialogController } from "./base-dialog-controller"
import renderChangesDialog from "@/eta/views/dialog/changes-dialog"

export const ChangesDialogEvent = {
  Approve:   "changes-dialog:approve",
  Reject:    "changes-dialog:reject",
  DiscardAll:"changes-dialog:discardAll",
  SaveAll:   "changes-dialog:saveAll",
  Done:      "changes-dialog:done",
  Reload:    "changes-dialog:reload",
  ReloadReady:"changes-dialog:reload-ready",
} as const

interface ChangesDialogItem {
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

export class ChangesDialogController extends BaseDialogController {
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

  connect() {
    this.element.innerHTML = renderChangesDialog(this.payloadValue)
    // The opener (facade) dispatches reload-ready on this element after it
    // has fetched the original content for a preview.
    this.element.addEventListener(ChangesDialogEvent.ReloadReady, ((e: CustomEvent<{ idx: number; text: string }>) => {
      this.reloadReady(e)
    }) as EventListener)
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
    const data = this.payloadValue.items[idx]
    if (!data) return

    if (data.notice) {
      const preview = this.previewTargets[idx]
      if (preview) {
        preview.innerHTML = `<div style="padding:8px 10px;color:#856404;background:#fff8e1;font-size:0.85rem">${data.notice}</div>`
      }
      return
    }

    if (!data.path) return
    this.dispatch("reload", { detail: { idx, path: data.path }, bubbles: true })
  }

  reloadReady(e: Event) {
    const { idx, text } = (e as CustomEvent<{ idx: number; text: string }>).detail
    const preview = this.previewTargets[idx]
    const data = this.payloadValue.items[idx]
    if (!preview || !data) return

    preview.innerHTML = renderPendingDiff(text, data.md ?? "")
  }

  approve(e: Event) {
    const path = (e.currentTarget as HTMLElement).dataset.opPath
    if (!path) return
    this.dispatch("approve", { detail: path, bubbles: true })
    this.removeRow((e.currentTarget as HTMLElement).closest(".inb4doc-changes-item"))
  }

  reject(e: Event) {
    const path = (e.currentTarget as HTMLElement).dataset.discardPath
    if (!path) return
    this.dispatch("reject", { detail: path, bubbles: true })
    this.removeRow((e.currentTarget as HTMLElement).closest(".inb4doc-changes-item"))
  }

  private removeRow(item: Element | null) {
    if (!item) return
    item.remove()
    const remaining = this.changeItemTargets.length
    this.headerTarget.textContent = `Pending changes (${remaining})`
    if (remaining === 0) {
      this.dispatch("done", { bubbles: true })
    }
  }

  saveAll() {
    this.dispatch("saveAll", { bubbles: true })
    this.dispatch("done", { bubbles: true })
  }

  discardAll() {
    this.dispatch("discardAll", { bubbles: true })
    this.dispatch("done", { bubbles: true })
  }

  close() {
    this.dispatch("done", { bubbles: true })
  }
}
