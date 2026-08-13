import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import { undoDepth, redoDepth } from "@milkdown/kit/prose/history"
import { appEvents, AppEvent } from "@/stores/app-events"

/**
 * Emits `AppEvent.HistoryChanged` whenever the undo/redo availability for the
 * current document changes — deduped on the `canUndo:canRedo` signature, so
 * typing inside the same depth range is silent.
 *
 * Undo history lives in the history plugin's state, which is part of the
 * editor state the controller caches per path (`editorStates`) and restores
 * with `view.updateState()`. `view.update()` fires on that restore, so the
 * emitted depths always describe the currently open file — a freshly loaded
 * file starts at (false, false) until the first edit.
 */
export function createHistoryContextPlugin() {
  let last = ""
  return new Plugin({
    key: new PluginKey("inb4doc-history-context"),
    view: () => ({
      update: (view) => {
        const state = view.state
        const canUndo = undoDepth(state) > 0
        const canRedo = redoDepth(state) > 0
        const sig = `${canUndo}:${canRedo}`
        if (sig === last) return
        last = sig
        appEvents.emit(AppEvent.HistoryChanged, { canUndo, canRedo })
      },
    }),
  })
}
