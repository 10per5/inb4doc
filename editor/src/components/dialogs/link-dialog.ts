import type { Editor } from "@milkdown/kit/core"
import { editorViewCtx } from "@milkdown/kit/core"
import { TextSelection } from "@milkdown/kit/prose/state"
import { toggleMark } from "prosemirror-commands"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderLinkDialog from "@/eta/dialogs/link-dialog"

export function openLinkDialog(getEditor: () => Editor | null) {
  const milkdown = getEditor()
  let initialUrl = ""

  if (milkdown) {
    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      const linkMark = state.schema.marks.link
      if (linkMark) {
        const mark = state.selection.$head.marks().find((m) => m.type === linkMark)
        if (mark) {
          initialUrl = mark.attrs.href ?? ""
        }
      }
    })
  }

  const inputId = "inb4doc-link-input-" + Math.random().toString(36).slice(2)

  const html = renderLinkDialog({ inputId, initialUrl })

  return openHtmlDialogPromise<string>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }).then((url) => {
    const editor = getEditor()
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      const { state, dispatch } = view
      const linkMark = state.schema.marks.link
      if (url) {
        toggleMark(linkMark, { href: url })(state, (tr) => {
          const afterLink = tr.selection.to
          tr.insert(afterLink, state.schema.text(" "))
          tr.setSelection(TextSelection.create(tr.doc, afterLink + 1))
          dispatch(tr.setStoredMarks([]))
        })
      } else {
        const $head = state.selection.$head
        const existingMark = $head.marks().find((m) => m.type === linkMark)
        if (existingMark) {
          let from = $head.pos
          let to = $head.pos
          while (from > 0) {
            const resolved = state.doc.resolve(from - 1)
            if (!resolved.marks().some((m) => m.type === linkMark)) break
            from--
          }
          while (to < state.doc.content.size) {
            const resolved = state.doc.resolve(to + 1)
            if (!resolved.marks().some((m) => m.type === linkMark)) break
            to++
          }
          dispatch(state.tr.removeMark(from, to, linkMark).setStoredMarks([]))
        } else {
          dispatch(state.tr.setStoredMarks([]))
        }
      }
    })
  })
}
