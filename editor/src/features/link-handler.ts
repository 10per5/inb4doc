/**
 * link-handler — subscribes to LinkDialogRequested events, reads the
 * current link mark, opens the pure-UI link dialog, and toggles the
 * mark. Receives an editor getter; all services are dynamically imported.
 *
 * No static imports of editorContext or prosemirror-commands.
 */

import type { Editor } from "@milkdown/kit/core"
import { appEvents, AppEvent } from "@/stores/app-events"

export function initLinkHandler(getEditor: () => Editor | null) {
  return appEvents.on(AppEvent.LinkDialogRequested, async () => {
    const editor = getEditor()
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
    await Promise.all([editorContext.load(), commandService.load()])

    let initialUrl = ""
    editor.action((ctx) => {
      const view = ctx.get(editorContext.editorViewCtx)
      const { state } = view
      const linkMark = state.schema.marks.link
      if (linkMark) {
        const mark = state.selection.$head.marks().find((m) => m.type === linkMark)
        if (mark) initialUrl = mark.attrs.href ?? ""
      }
    })

    const { openLinkDialog } = await import("@/controllers/dialog/link-dialog")
    const url = await openLinkDialog(initialUrl)

    const { toggleMark } = await import("prosemirror-commands")
    editor.action((ctx) => {
      const view = ctx.get(editorContext.editorViewCtx)
      view.focus()
      const { state, dispatch } = view
      const linkMark = state.schema.marks.link
      if (url) {
        toggleMark(linkMark, { href: url })(state, (tr) => {
          const afterLink = tr.selection.to
          tr.insert(afterLink, state.schema.text(" "))
          tr.setSelection(editorContext.TextSelection.create(tr.doc, afterLink + 1))
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
