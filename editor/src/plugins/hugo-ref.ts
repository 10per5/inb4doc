import type { EditorView } from "prosemirror-view"
import { openHugoRefDialog } from "@/controllers/dialog/hugoref-dialog"

export function initHugoRefClicks(view: EditorView) {
  const handler = (e: Event) => {
    const el = (e.target as HTMLElement).closest("[data-hugo-ref]") as HTMLElement | null
    if (!el) return
    e.preventDefault()
    const pos = view.posAtDOM(el, 0)
    if (pos != null) {
      openHugoRefDialog(view, pos)
    }
  }
  view.dom.addEventListener("click", handler)
}
