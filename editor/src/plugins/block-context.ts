import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state"
import { appEvents, AppEvent } from "@/stores/app-events"
import {
  EMPTY_BLOCK_CONTEXT,
  type ActiveBlockContext,
} from "@/config/enums/block-context"

/**
 * Resolve the block the current selection sits in. Walks up from the deepest
 * resolved position to find a `list_item` node, then classifies it:
 * - `task` when the item carries a boolean `checked` attr (GFM task list)
 * - `ordered` / `bullet` from the parent list node
 * Everything else (paragraphs, headings, code blocks, …) is "not a list item".
 */
export function getActiveBlockContext(state: EditorState): ActiveBlockContext {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name !== "list_item") continue
    // The item's index within its parent list (depth d-1). sinkListItem fails
    // when the item is the first child of the list (startIndex == 0), so only
    // items at index > 0 can be indented further.
    const canSink = $from.index(d - 1) > 0
    const checked = node.attrs.checked
    if (typeof checked === "boolean") {
      return { isListItem: true, listType: "task", checked, canSink }
    }
    const parentName = $from.node(d - 1).type.name
    return {
      isListItem: true,
      listType: parentName === "ordered_list" ? "ordered" : "bullet",
      checked: null,
      canSink,
    }
  }
  return EMPTY_BLOCK_CONTEXT
}

/**
 * Emits `AppEvent.BlockContextChanged` when the active block changes — deduped
 * on the block signature, so typing inside the same block is silent. The
 * signature includes the block's start position, so moving the caret to a
 * different block (even one with the same list context, e.g. paragraph →
 * paragraph) still fires and lets consumers re-anchor.
 */
export function createBlockContextPlugin() {
  let last = ""
  return new Plugin({
    key: new PluginKey("inb4doc-block-context"),
    view: () => ({
      update: (view) => {
        const state = view.state
        const context = getActiveBlockContext(state)
        const sig = `${activeBlockStart(state)}:${JSON.stringify(context)}`
        if (sig === last) return
        last = sig
        appEvents.emit(AppEvent.BlockContextChanged, { context })
      },
    }),
  })
}

function activeBlockStart(state: EditorState): number {
  const { $from } = state.selection
  let d = $from.depth
  while (d > 0 && !$from.node(d).isBlock) d--
  return d > 0 ? $from.before(d) : 0
}
