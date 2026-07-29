/**
 * toolbar-handler — subscribes to ToolbarCommandExec events and dispatches
 * Milkdown commands. Receives an editor getter; imports services lazily.
 *
 * No static imports of editorContext or commandService — both are
 * dynamically imported inside the handler to keep the main bundle free.
 */

import type { Editor } from "@milkdown/kit/core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"

export function initToolbarHandler(getEditor: () => Editor | null) {
  return appEvents.on(AppEvent.ToolbarCommandExec, async ({ command, level }) => {
    const editor = getEditor()
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
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
      }
    })
  })
}
