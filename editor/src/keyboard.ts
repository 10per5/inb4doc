import { keymap } from "@milkdown/kit/prose/keymap"
import { undo, redo } from "@milkdown/kit/prose/history"
import { toggleMark, setBlockType } from "prosemirror-commands"
import { wrapInList } from "prosemirror-schema-list"

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
  })
}
