import { Plugin, PluginKey } from "prosemirror-state"
import { createMarkdownBridge } from "@/config/editor-markdown"
import { appEvents, AppEvent } from "@/stores/app-events"

export interface DirtyPluginConfig {
  getLastSetContent: (path: string) => string | undefined
  setLastSetContent: (path: string, content: string) => void
  getCurrentPath: () => string
}

/**
 * Detects ProseMirror document changes for the active editor, serializes the
 * doc to Markdown, and emits `AppEvent.EditorChanged`.
 *
 * This plugin is intentionally thin: it only knows how to serialize (it has the
 * Milkdown `ctx`) and detect changes. All dirty-state bookkeeping, debouncing,
 * persistence, and counter recomputation live in `DirtyTrackingService`, which
 * subscribes to `EditorChanged`.
 */
export function createDirtyPlugin(config: DirtyPluginConfig) {
  return new Plugin({
    key: new PluginKey("inb4doc-dirty"),
    view: (editorView) => {
      const bridge = createMarkdownBridge(editorView.state.schema)
      return {
        update: (view, prevState) => {
          if (!prevState) return
          if (view.state.doc.eq(prevState.doc)) return

          const path = config.getCurrentPath()
          const prevLastSet = config.getLastSetContent(path)
          if (prevLastSet === undefined) {
            config.setLastSetContent(
              path,
              bridge.serialize(view.state.doc)
                .replace(/\r\n/g, "\n")
                .replace(/\n+$/, "\n"),
            )
            return
          }

          const md = bridge.serialize(view.state.doc)
            .replace(/\r\n/g, "\n")
            .replace(/\n+$/, "\n")

          if (md === prevLastSet) return
          config.setLastSetContent(path, md)
          appEvents.emit(AppEvent.EditorChanged, { path, md })
        },
      }
    },
  })
}
