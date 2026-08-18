import type { EditorView } from "prosemirror-view"
import { openDialog } from "@/services/dialog-service"

export function openHugoRefDialog(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== "hugoRef") return

  const currentPath = node.attrs.path
  const currentTitle = node.attrs.title
  const pathId = "inb4doc-hugoref-path-" + Math.random().toString(36).slice(2)
  const titleId = "inb4doc-hugoref-title-" + Math.random().toString(36).slice(2)

  const handle = openDialog<{ path: string; title: string }>("hugoref-dialog", {
    pathId,
    titleId,
    currentPath,
    currentTitle,
  })

  handle.promise.then((result) => {
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
  handle.overlay.addEventListener("hugoref-dialog:remove", removeHandler, { once: true })
}
