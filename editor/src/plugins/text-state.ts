import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state"
import type { MarkType } from "@milkdown/kit/prose/model"
import { appEvents, AppEvent } from "@/stores/app-events"
import type { TextState } from "@/config/enums/text-state"

/**
 * True when the mark is active over the *whole* selection:
 * - collapsed cursor → the marks in effect at that position (`storedMarks`
 *   after a toggle, falling back to the marks around the cursor);
 * - spanned selection → every text node in the range must carry the mark; a
 *   range with no text nodes (e.g. a leaf block such as an HR) reports
 *   inactive, since nothing in it can carry a mark.
 * `rangeHasMark` is deliberately avoided — it reports "any sub-range has the
 * mark", which would light up the button for a selection that is only
 * partially formatted. Text nodes are uniformly marked, so checking each text
 * node overlapping the range is exact.
 */
function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty } = state.selection
  if (empty) {
    return !!type.isInSet(state.storedMarks || state.selection.$from.marks())
  }
  let active = true
  let hasText = false
  state.doc.nodesBetween(from, to, (node) => {
    if (!active || !node.isText) return
    hasText = true
    if (node.marks.length === 0 || !type.isInSet(node.marks)) active = false
    return active
  })
  return active && hasText
}

export function getTextState(state: EditorState): TextState {
  const { $from } = state.selection
  let heading = 0
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === "heading") {
      heading = node.attrs.level as number
      break
    }
  }
  const marks = state.schema.marks
  return {
    bold: markActive(state, marks.strong),
    italic: markActive(state, marks.emphasis),
    strike: markActive(state, marks.strike_through),
    code: markActive(state, marks.inlineCode),
    link: markActive(state, marks.link),
    heading,
  }
}

/**
 * Emits `AppEvent.TextStateChanged` whenever the formatting state at the
 * selection changes — marks (bold/italic/strike/code/link) or the heading
 * level of the active block. Deduped on the state signature so typing inside
 * already formatted text stays silent.
 */
export function createTextStatePlugin() {
  let last = ""
  return new Plugin({
    key: new PluginKey("inb4doc-text-state"),
    view: () => ({
      update: (view) => {
        const textState = getTextState(view.state)
        const sig = `${textState.bold}|${textState.italic}|${textState.strike}|${textState.code}|${textState.link}|${textState.heading}`
        if (sig === last) return
        last = sig
        appEvents.emit(AppEvent.TextStateChanged, textState)
      },
    }),
  })
}
