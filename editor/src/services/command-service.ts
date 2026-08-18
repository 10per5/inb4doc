import { toggleMark, wrapIn, setBlockType, lift } from "prosemirror-commands"
import { wrapInList, liftListItem } from "prosemirror-schema-list"
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
    return (state, dispatch) => toggleMark(state.schema.marks.strong)(state, dispatch)
  }

  get toggleEmphasisCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.emphasis)(state, dispatch)
  }

  get toggleInlineCodeCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.inlineCode)(state, dispatch)
  }

  get wrapInHeadingCommand(): PMCommand {
    return (state, dispatch) => {
      const nodeType = state.schema.nodes.heading
      return nodeType ? setBlockType(nodeType)(state, dispatch) : false
    }
  }

  get insertHrCommand(): PMCommand {
    return (state, dispatch) => {
      const nodeType = state.schema.nodes.hr
      if (!nodeType) return false
      if (dispatch) {
        const tr = state.tr.replaceSelectionWith(nodeType.create())
        dispatch(tr)
      }
      return true
    }
  }

  get sinkListItemCommand(): PMCommand {
    return (state, dispatch) => liftListItem(state.schema.nodes.list_item)(state, dispatch)
  }

  get liftListItemCommand(): PMCommand {
    return lift
  }

  get wrapInBulletListCommand(): PMCommand {
    return (state, dispatch) => wrapInList(state.schema.nodes.bullet_list)(state, dispatch)
  }

  get wrapInOrderedListCommand(): PMCommand {
    return (state, dispatch) => wrapInList(state.schema.nodes.ordered_list)(state, dispatch)
  }

  get wrapInBlockquoteCommand(): PMCommand {
    return (state, dispatch) => wrapIn(state.schema.nodes.blockquote)(state, dispatch)
  }

  get toggleStrikethroughCommand(): PMCommand {
    return (state, dispatch) => toggleMark(state.schema.marks.strike_through)(state, dispatch)
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
