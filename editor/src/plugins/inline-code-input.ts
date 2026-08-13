import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state"

// Owns the whole backtick gesture: typing the closing backtick converts
// `` `text `` to inline code (caret lands outside, stored marks cleared), and
// typing the opening backtick before an existing closing backtick consumes it
// and marks the text between. The stock `inlineCodeInputRule` leaves the
// trailing backtick inside the code mark. Mark type is
// `schema.marks.inlineCode` (the `code` alias is absent in Milkdown).
function codeMarkType(state: any): any {
  return state.schema.marks.inlineCode ?? state.schema.marks.code
}

export function createInlineCodeInputPlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-inline-code-input"),
    props: {
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
