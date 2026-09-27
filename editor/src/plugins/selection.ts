import type { EditorView } from "prosemirror-view"
import { Plugin, PluginKey } from "prosemirror-state"
import { appEvents, AppEvent } from "@/stores/app-events"

// Emits an EditorSelectionChanged event whenever the selection range moves,
// so UI like the status bar can reflect the current selection without polling.
export function createSelectionPlugin(): Plugin {
  let last = ""
  return new Plugin({
    key: new PluginKey("inb4doc-selection"),
    view: () => ({
      update: (view: EditorView) => {
        const { from, to } = view.state.selection
        const sig = `${from}:${to}`
        if (sig === last) return
        last = sig
        appEvents.emit(AppEvent.EditorSelectionChanged, { from, to })
      },
    }),
  })
}
