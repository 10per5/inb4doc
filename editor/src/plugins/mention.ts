import { Plugin, PluginKey } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { MentionView } from "@/features/mention"

export function createMentionPlugin(
  _ctx?: unknown,
  setMentionView?: (mv: MentionView | null) => void,
) {
  return new Plugin({
    key: new PluginKey("inb4doc-mention"),
    view(editorView: EditorView) {
      const mentionView = new MentionView(editorView)
      setMentionView?.(mentionView)
      return {
        update: (view, prevState) => mentionView.update(view, prevState),
        destroy: () => {
          mentionView.destroy()
          setMentionView?.(null)
        },
      }
    },
  })
}
