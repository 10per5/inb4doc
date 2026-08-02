import { keymap } from "@milkdown/kit/prose/keymap"
import { undo, redo } from "@milkdown/kit/prose/history"
import { TextSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state"
import { toggleMark, setBlockType } from "prosemirror-commands"
import { wrapInList } from "prosemirror-schema-list"

function moveBlock(
  state: any,
  dispatch: any,
  dir: -1 | 1,
): boolean {
  const { $from } = state.selection
  if ($from.depth < 1) return false

  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") {
      itemDepth = d
      break
    }
  }
  if (itemDepth === -1) {
    itemDepth = 1
  }

  const parentDepth = itemDepth - 1
  const parentNode = $from.node(parentDepth)
  const itemStart = $from.before(itemDepth)
  const contentBase = parentDepth === 0 ? 0 : $from.before(parentDepth) + 1

  const itemIndex = $from.index(itemDepth - 1)
  const targetIndex = itemIndex + dir
  if (targetIndex < 0 || targetIndex >= parentNode.childCount) return false

  const node = parentNode.child(itemIndex)
  const size = node.nodeSize
  const tr = state.tr
  tr.delete(itemStart, itemStart + size)

  let offBeforeTarget = 0
  for (let j = 0; j < targetIndex; j++) {
    offBeforeTarget += parentNode.child(j).nodeSize
  }
  const targetSize = parentNode.child(targetIndex).nodeSize

  let insertPos: number
  if (dir === -1) {
    insertPos = contentBase + offBeforeTarget
  } else {
    insertPos = contentBase + offBeforeTarget - size + targetSize
  }

  tr.insert(insertPos, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))

  if (dispatch) dispatch(tr.scrollIntoView())
  return true
}

export function createKeymap() {
  return keymap({
    "Mod-b": (state, dispatch) => toggleMark(state.schema.marks.strong)(state, dispatch),
    "Mod-B": (state, dispatch) => toggleMark(state.schema.marks.strong)(state, dispatch),
    "Mod-i": (state, dispatch) => toggleMark(state.schema.marks.em)(state, dispatch),
    "Mod-I": (state, dispatch) => toggleMark(state.schema.marks.em)(state, dispatch),
    "Mod-`": (state, dispatch) => toggleMark(state.schema.marks.code)(state, dispatch),
    "Mod-Shift-s": (state, dispatch) => toggleMark(state.schema.marks.strikethrough)(state, dispatch),
    "Mod-Shift-x": (state, dispatch) => toggleMark(state.schema.marks.strikethrough)(state, dispatch),
    "Mod-Alt-1": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 1 })(state, dispatch),
    "Mod-Alt-2": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 2 })(state, dispatch),
    "Mod-Alt-3": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 3 })(state, dispatch),
    "Mod-Shift-7": (state, dispatch) => wrapInList(state.schema.nodes.ordered_list)(state, dispatch),
    "Mod-Shift-8": (state, dispatch) => wrapInList(state.schema.nodes.bullet_list)(state, dispatch),
    "Mod-Shift--": (state, dispatch) => {
      const hr = state.schema.nodes.hr.create()
      const tr = state.tr.replaceSelectionWith(hr)
      if (dispatch) dispatch(tr.scrollIntoView())
      return true
    },
    "Mod-z": (state, dispatch) => undo(state, dispatch),
    "Mod-Z": (state, dispatch) => redo(state, dispatch),
    "Mod-y": (state, dispatch) => redo(state, dispatch),
    "Mod-ArrowUp": (state, dispatch) => moveBlock(state, dispatch, -1),
    "Mod-ArrowDown": (state, dispatch) => moveBlock(state, dispatch, 1),
  })
}

const codeBlockMoveKey = new PluginKey("code-block-block-move")

export function createCodeBlockMovePlugin() {
  return new Plugin({
    key: codeBlockMoveKey,
    view: (view) => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        const target = event.target as HTMLElement | null
        if (!target || !target.closest(".code-block-wrapper")) return
        const dir = event.key === "ArrowUp" ? -1 : 1
        if (moveBlock(view.state, view.dispatch, dir)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      view.dom.addEventListener("keydown", onKeyDown, true)
      return {
        destroy: () => view.dom.removeEventListener("keydown", onKeyDown, true),
      }
    },
  })
}
