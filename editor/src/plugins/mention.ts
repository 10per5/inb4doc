import { Plugin, PluginKey } from "prosemirror-state"

export function createMentionPlugin(_ctx?: unknown, setMentionView?: (mv: null) => void) {
  setMentionView?.(null)
  return new Plugin({
    key: new PluginKey("inb4doc-mention"),
  })
}
