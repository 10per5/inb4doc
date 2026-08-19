import { Plugin, PluginKey, TextSelection } from "prosemirror-state"

// Owns the whole backtick gesture: typing the closing backtick converts
// `` `text `` to inline code (caret lands outside, stored marks cleared), and
// typing the opening backtick before an existing closing backtick consumes it
// and marks the text between. The stock `inlineCodeInputRule` leaves the
// trailing backtick inside the code mark. Mark type is
// `schema.marks.code`.
function codeMarkType(state: any): any {
  return state.schema.marks.code
}

export function createInlineCodeInputPlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-inline-code-input"),
    props: {
      // Tapping/clicking at a block edge that touches inline code would leave
      // the code mark stored (typing stays code-styled). Landing at a code
      // boundary clears it so the caret starts outside the span.
      handleClick: (view, pos, event) => {
        if (event.button > 0 || event.detail !== 1) return false
        const { state } = view
        const $pos = state.doc.resolve(pos)
        if ($pos.parent.type.spec.code) return false
        const codeType = codeMarkType(state)
        if (!codeType) return false
        const start = $pos.start()
        const end = $pos.end()
        const atBoundary =
          (pos === start && state.doc.rangeHasMark(start, start + 1, codeType)) ||
          (pos === end && state.doc.rangeHasMark(end - 1, end, codeType))
        if (!atBoundary) return false
        view.dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, pos))
            .setStoredMarks([])
            .scrollIntoView(),
        )
        return true
      },
      handleTextInput: (view, from, to, text) => {
        if (text !== "`" || from !== to) return false
        const { state } = view
        const { $from } = state.selection
        if ($from.parent.type.spec.code) return false
        if ($from.marks().some((m) => m.type.spec.code)) return false
        const codeType = codeMarkType(state)
        if (!codeType) return false

        const parentStart = $from.start()
        const offset = from - parentStart
        const textBefore = $from.parent.textBetween(0, offset, null, "\uFFFC")
        const textAfter = $from.parent.textBetween(
          offset,
          $from.parent.content.size,
          null,
          "\uFFFC",
        )

        const lastTick = textBefore.lastIndexOf("`")
        if (lastTick !== -1 && textBefore.length - 1 - lastTick > 0) {
          const contentLength = textBefore.length - 1 - lastTick
          return convertClosing(view, parentStart + lastTick, contentLength, codeType)
        }

        const nextTick = textAfter.indexOf("`")
        if (nextTick === -1 || nextTick === 0) return false
        return convertOpening(view, from, nextTick, codeType)
      },
    },
  })
}

function convertClosing(
  view: any,
  openingPos: number,
  contentLength: number,
  codeType: any,
): boolean {
  const { state } = view
  const tr = state.tr
  tr.delete(openingPos, openingPos + 1)
  tr.addMark(openingPos, openingPos + contentLength, codeType.create())
  tr.setStoredMarks([])
  tr.setSelection(TextSelection.create(tr.doc, openingPos + contentLength))
  view.dispatch(tr.scrollIntoView())
  return true
}

function convertOpening(
  view: any,
  from: number,
  contentLength: number,
  codeType: any,
): boolean {
  const { state } = view
  const tr = state.tr
  const closePos = from + contentLength
  tr.delete(closePos, closePos + 1)
  tr.addMark(from, closePos, codeType.create())
  tr.setStoredMarks([])
  tr.setSelection(TextSelection.create(tr.doc, closePos))
  view.dispatch(tr.scrollIntoView())
  return true
}
