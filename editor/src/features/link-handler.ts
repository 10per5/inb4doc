/**
 * link-handler — subscribes to LinkDialogRequested events, reads the
 * current link mark, opens the pure-UI link dialog, and toggles the
 * mark. Receives an editor view getter; all services are dynamically imported.
 *
 * No static imports of editorContext or prosemirror-commands.
 */

import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { appEvents, AppEvent } from "@/stores/app-events"

export function initLinkHandler(getView: () => EditorView | null) {
  return appEvents.on(AppEvent.LinkDialogRequested, async () => {
    const view = getView()
    if (!view) return

    const { openLinkDialog } = await import("@/controllers/dialog/link-dialog")
    const { toggleMark } = await import("prosemirror-commands")

    let initialUrl = ""
    const { state } = view
    const linkMark = state.schema.marks.link
    if (linkMark) {
      const mark = state.selection.$head.marks().find((m) => m.type === linkMark)
      if (mark) initialUrl = mark.attrs.href ?? ""
    }

    const url = await openLinkDialog(initialUrl)

    view.focus()
    const { state: curState, dispatch } = view
    if (!linkMark) return

    if (url) {
      toggleMark(linkMark, { href: url })(curState, (tr) => {
        const afterLink = tr.selection.to
        tr.insert(afterLink, curState.schema.text(" "))
        tr.setSelection(TextSelection.create(tr.doc, afterLink + 1))
        dispatch(tr.setStoredMarks([]))
      })
    } else {
      const $head = curState.selection.$head
      const existingMark = $head.marks().find((m) => m.type === linkMark)
      if (existingMark) {
        let from = $head.pos
        let to = $head.pos
        while (from > 0) {
          const resolved = curState.doc.resolve(from - 1)
          if (!resolved.marks().some((m) => m.type === linkMark)) break
          from--
        }
        while (to < curState.doc.content.size) {
          const resolved = curState.doc.resolve(to + 1)
          if (!resolved.marks().some((m) => m.type === linkMark)) break
          to++
        }
        dispatch(curState.tr.removeMark(from, to, linkMark).setStoredMarks([]))
      } else {
        dispatch(curState.tr.setStoredMarks([]))
      }
    }
  })
}
