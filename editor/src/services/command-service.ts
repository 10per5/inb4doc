import { toggleMark, wrapIn, setBlockType, lift } from "prosemirror-commands"
import { createToggleListCommand, createIndentListCommand, createDedentListCommand } from "prosemirror-flat-list"
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable, isInTable, selectedRect, selectionCell, CellSelection } from "prosemirror-tables"
import type { EditorState, Transaction } from "prosemirror-state"

type PMCommand = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

class CommandService {
  load(): Promise<void> {
    return Promise.resolve()
  }

  get loaded(): boolean {
    return true
  }

  get toggleStrongCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.bold)(state, dispatch)
  }

  get toggleEmphasisCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.italic)(state, dispatch)
  }

  get toggleInlineCodeCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.code)(state, dispatch)
  }

  get wrapInHeadingCommand(): PMCommand {
    return (state, dispatch) => {
      const nodeType = state.schema.nodes.heading
      return nodeType ? setBlockType(nodeType)(state, dispatch) : false
    }
  }

  get insertHrCommand(): PMCommand {
    return (state, dispatch) => {
      const nodeType = state.schema.nodes.horizontalRule
      if (!nodeType) return false
      if (dispatch) {
        const tr = state.tr.replaceSelectionWith(nodeType.create())
        dispatch(tr)
      }
      return true
    }
  }

  get indentListCommand(): PMCommand {
    return createIndentListCommand()
  }

  get dedentListCommand(): PMCommand {
    return createDedentListCommand()
  }

  get toggleBulletListCommand(): PMCommand {
    return createToggleListCommand({ kind: "bullet" })
  }

  get toggleOrderedListCommand(): PMCommand {
    return createToggleListCommand({ kind: "ordered" })
  }

  get wrapInBlockquoteCommand(): PMCommand {
    return (state, dispatch) => {
      const blockquote = state.schema.nodes.blockquote
      if (!blockquote) return false
      // If already inside a blockquote, lift out of it (toggle off)
      const $from = state.selection.$from
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === blockquote) {
          return lift(state, dispatch)
        }
      }
      // Otherwise wrap in blockquote (toggle on)
      return wrapIn(blockquote)(state, dispatch)
    }
  }

  get toggleStrikethroughCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.strike)(state, dispatch)
  }

  get addRowAfterCommand(): PMCommand {
    return addRowAfter
  }

  get addColAfterCommand(): PMCommand {
    return addColumnAfter
  }

  get selectRowCommand(): PMCommand {
    return (state, dispatch) => {
      if (!dispatch || !isInTable(state)) return false
      const $cell = selectionCell(state)
      const sel = CellSelection.rowSelection($cell)
      dispatch(state.tr.setSelection(sel))
      return true
    }
  }

  get selectColCommand(): PMCommand {
    return (state, dispatch) => {
      if (!dispatch || !isInTable(state)) return false
      const $cell = selectionCell(state)
      const sel = CellSelection.colSelection($cell)
      dispatch(state.tr.setSelection(sel))
      return true
    }
  }

  get selectTableCommand(): PMCommand {
    return (state, dispatch) => {
      if (!dispatch || !isInTable(state)) return false
      const { left, right, top, bottom } = selectedRect(state)
      const { doc } = state
      const anchor = doc.resolve(top === 0 ? 0 : top)
      const head = doc.resolve(Math.min(right, doc.content.size))
      const sel = CellSelection.create(doc, anchor.pos, head.pos)
      dispatch(state.tr.setSelection(sel))
      return true
    }
  }

  get deleteSelectedCellsCommand(): PMCommand {
    return (state, dispatch) => deleteRow(state, dispatch)
  }
}

export const commandService = new CommandService()
