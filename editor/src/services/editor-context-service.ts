import type { EditorView } from "prosemirror-view"
import { TextSelection, NodeSelection, Plugin, PluginKey, EditorState } from "prosemirror-state"
import type { EditorInstance } from "@/config/editor-config"
import { createMarkdownBridge } from "@/config/editor-markdown"

class EditorContextService {
  loaded = true

  get TextSelection() { return TextSelection }
  get NodeSelection() { return NodeSelection }
  get Plugin() { return Plugin }
  get PluginKey() { return PluginKey }
  get EditorState() { return EditorState }
}

export const editorContext = new EditorContextService()

// ── Convenience wrappers ──

export function getView(editor: EditorInstance): EditorView {
  return editor.view
}

export function getMarkdown(editor: EditorInstance): string {
  const view = editor.view
  const bridge = createMarkdownBridge(view.state.schema)
  return bridge.serialize(view.state.doc)
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "\n")
}

export function focusView(editor: EditorInstance): void {
  editor.view.focus()
}
