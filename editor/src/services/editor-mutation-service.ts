import type { EditorView } from "prosemirror-view"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import { clearListItems, setListItemKind, setTaskChecked, toggleTaskChecked } from "@/utils/editor-mutator"

export function initEditorMutationService(getEditor: () => { action: (fn: (ctx: any) => void) => any } | null) {
  const unsubToolbar = appEvents.on(AppEvent.ToolbarCommandExec, async ({ command, level }) => {
    const editor = getEditor()
    if (!editor) return

    const { commandService } = await import("@/services/command-service")
    const { undo, redo } = await import("prosemirror-history")
    await commandService.load()

    if (command === ToolbarCommand.Link) {
      appEvents.emit(AppEvent.LinkDialogRequested)
      return
    }

    editor.action(({ view }) => {
      view.focus()
      const { state, dispatch } = view

      switch (command) {
        case ToolbarCommand.Bold:
          commandService.toggleStrongCommand(state, dispatch); break
        case ToolbarCommand.Italic:
          commandService.toggleEmphasisCommand(state, dispatch); break
        case ToolbarCommand.Strike:
          commandService.toggleStrikethroughCommand(state, dispatch); break
        case ToolbarCommand.Code:
          commandService.toggleInlineCodeCommand(state, dispatch); break
        case ToolbarCommand.Hr:
          commandService.insertHrCommand(state, dispatch); break
        case ToolbarCommand.Heading:
          commandService.wrapInHeadingCommand(state, dispatch); break
        case ToolbarCommand.Indent:
          commandService.indentListCommand(state, dispatch); break
        case ToolbarCommand.Unindent:
          commandService.dedentListCommand(state, dispatch); break
        case ToolbarCommand.BulletList:
          setListItemKind(view, "bullet"); break
        case ToolbarCommand.TaskList:
          setListItemKind(view, "task"); break
        case ToolbarCommand.OrderedList:
          setListItemKind(view, "ordered"); break
        case ToolbarCommand.MarkTask:
          setTaskChecked(view, true); break
        case ToolbarCommand.UnmarkTask:
          setTaskChecked(view, false); break
        case ToolbarCommand.Blockquote:
          commandService.wrapInBlockquoteCommand(state, dispatch); break
        case ToolbarCommand.ToggleTaskChecked:
          toggleTaskChecked(view); break
        case ToolbarCommand.ExitList:
          clearListItems(view); break
        case ToolbarCommand.AddRow:
          commandService.addRowAfterCommand(state, dispatch); break
        case ToolbarCommand.AddCol:
          commandService.addColAfterCommand(state, dispatch); break
        case ToolbarCommand.RemoveRow:
        case ToolbarCommand.DeleteCol:
        case ToolbarCommand.RemoveTable:
          break
        case ToolbarCommand.Undo:
          undo(state, dispatch); break
        case ToolbarCommand.Redo:
          redo(state, dispatch); break
      }
    })

    if (command === ToolbarCommand.RemoveRow || command === ToolbarCommand.DeleteCol || command === ToolbarCommand.RemoveTable) {
      const { deleteRow, deleteColumn, deleteTable } = await import("prosemirror-tables")
      editor.action(({ view }) => {
        const { state, dispatch } = view
        if (command === ToolbarCommand.RemoveRow) deleteRow(state, dispatch)
        else if (command === ToolbarCommand.DeleteCol) deleteColumn(state, dispatch)
        else deleteTable(state, dispatch)
      })
    }
  })

  const unsubInsert = appEvents.on(AppEvent.InsertBlockCommand, async ({ command, level }) => {
    let editor = getEditor()
    if (!editor) {
      appEvents.emit(AppEvent.CreateFirstPage)
      editor = getEditor()
    }
    if (!editor) return

    const { commandService } = await import("@/services/command-service")
    await commandService.load()

    const { executeInsertCommand } = await import("@/features/insert-command")
    editor.action(({ view }) => {
      executeInsertCommand(view, command, level, { appendBelow: true })
    })
  })

  return () => {
    unsubToolbar()
    unsubInsert()
  }
}
