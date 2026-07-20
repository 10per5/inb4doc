import type { EditorView } from "@milkdown/kit/prose/view"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderHugoRefDialog from "@/eta/dialogs/hugo-ref-dialog"

export function openHugoRefDialog(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== "hugoRef") return

  const currentPath = node.attrs.path
  const currentTitle = node.attrs.title
  const pathId = "inb4doc-hugoref-path-" + Math.random().toString(36).slice(2)
  const titleId = "inb4doc-hugoref-title-" + Math.random().toString(36).slice(2)

  const html = renderHugoRefDialog({ pathId, titleId, currentPath, currentTitle })

  const overlay = document.getElementById("inb4doc-dialog-overlay")

  openHtmlDialogPromise<{ path: string; title: string } | null>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }).then((result) => {
    if (!result) return
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      path: result.path,
      title: result.title,
    })
    view.dispatch(tr)
    view.focus()
  })

  const removeHandler = () => {
    const { nodeSize } = node
    const tr = view.state.tr.delete(pos, pos + nodeSize)
    view.dispatch(tr)
    view.focus()
  }

  // Listen for remove events from the controller
  requestAnimationFrame(() => {
    const overlay = document.getElementById("inb4doc-dialog-overlay")
    if (overlay) {
      overlay.addEventListener("hugoref-dialog:remove", removeHandler, { once: true })
    }
  })
}
