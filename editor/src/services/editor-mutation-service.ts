/**
 * editor-mutation-service — routes document-mutation intents to the Milkdown
 * editor.
 *
 * Every surface that mutates the open document funnels through one of two
 * events: AppEvent.ToolbarCommandExec (topbar + quick bar) and
 * AppEvent.InsertBlockCommand (slash menu, mobile FAB "+", block handle "+").
 * This service subscribes to both and dispatches them via editor.action().
 * The heavy list conversions live in utils/editor-mutator.ts so every caller
 * shares the same coverage/split/merge rules.
 *
 * Receives an editor getter (the editor is owned by EditorController, is lazily
 * created and can be null); imports services lazily to keep the main bundle
 * free.
 */

import type { Editor } from "@milkdown/kit/core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import { clearListItems, setListItemKind, setTaskChecked, toggleTaskChecked } from "@/utils/editor-mutator"

export function initEditorMutationService(getEditor: () => Editor | null) {
  const unsubToolbar = appEvents.on(AppEvent.ToolbarCommandExec, async ({ command, level }) => {
    const editor = getEditor()
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
    const { isInTable, selectedRect } = await import("@milkdown/kit/prose/tables")
    const { undo, redo } = await import("@milkdown/kit/prose/history")
    await Promise.all([editorContext.load(), commandService.load()])

    if (command === ToolbarCommand.Link) {
      appEvents.emit(AppEvent.LinkDialogRequested)
      return
    }

    editor.action((ctx) => {
      const view = ctx.get(editorContext.editorViewCtx)
      view.focus()
      const commands = ctx.get(editorContext.commandsCtx)

      switch (command) {
        case ToolbarCommand.Bold:
          commands.call(commandService.toggleStrongCommand.key); break
        case ToolbarCommand.Italic:
          commands.call(commandService.toggleEmphasisCommand.key); break
        case ToolbarCommand.Strike:
          commands.call(commandService.toggleStrikethroughCommand.key); break
        case ToolbarCommand.Code:
          commands.call(commandService.toggleInlineCodeCommand.key); break
        case ToolbarCommand.Hr:
          commands.call(commandService.insertHrCommand.key); break
        case ToolbarCommand.Heading:
          commands.call(commandService.wrapInHeadingCommand.key, level); break
        case ToolbarCommand.Indent:
          commands.call(commandService.sinkListItemCommand.key); break
        case ToolbarCommand.Unindent:
          commands.call(commandService.liftListItemCommand.key); break
        case ToolbarCommand.BulletList:
          setListItemKind(view, commands, commandService, "bullet"); break
        case ToolbarCommand.TaskList:
          setListItemKind(view, commands, commandService, "task"); break
        case ToolbarCommand.OrderedList:
          setListItemKind(view, commands, commandService, "ordered"); break
        case ToolbarCommand.MarkTask:
          setTaskChecked(view, true); break
        case ToolbarCommand.UnmarkTask:
          setTaskChecked(view, false); break
        case ToolbarCommand.Blockquote:
          commands.call(commandService.wrapInBlockquoteCommand.key); break
        case ToolbarCommand.ToggleTaskChecked:
          toggleTaskChecked(view); break
        case ToolbarCommand.ExitList:
          clearListItems(view); break
        case ToolbarCommand.AddRow:
          commands.call(commandService.addRowAfterCommand.key); break
        case ToolbarCommand.AddCol:
          commands.call(commandService.addColAfterCommand.key); break
        case ToolbarCommand.RemoveRow:
          if (isInTable(view.state)) {
            const { top } = selectedRect(view.state)
            commands.call(commandService.selectRowCommand.key, { index: top })
            commands.call(commandService.deleteSelectedCellsCommand.key)
          }
          break
        case ToolbarCommand.DeleteCol:
          if (isInTable(view.state)) {
            const { left } = selectedRect(view.state)
            commands.call(commandService.selectColCommand.key, { index: left })
            commands.call(commandService.deleteSelectedCellsCommand.key)
          }
          break
        case ToolbarCommand.RemoveTable:
          commands.call(commandService.selectTableCommand.key)
          commands.call(commandService.deleteSelectedCellsCommand.key)
          break
        case ToolbarCommand.Undo:
          undo(view.state, view.dispatch); break
        case ToolbarCommand.Redo:
          redo(view.state, view.dispatch); break
      }
    })
  })

  const unsubInsert = appEvents.on(AppEvent.InsertBlockCommand, async ({ command, level }) => {
    let editor = getEditor()
    if (!editor) {
      appEvents.emit(AppEvent.CreateFirstPage)
      editor = getEditor()
    }
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
    await Promise.all([editorContext.load(), commandService.load()])

    const { executeInsertCommand } = await import("@/features/insert-command")
    editor.action((ctx) => {
      executeInsertCommand(ctx, command, level, { appendBelow: true })
    })
  })

  return () => {
    unsubToolbar()
    unsubInsert()
  }
}
