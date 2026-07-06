import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { Ctx } from "@milkdown/kit/ctx"
import { MentionView } from "@/features/mention"

export function createMentionPlugin(ctx: Ctx, setMentionView: (mv: MentionView | null) => void) {
  return new Plugin({
    key: new PluginKey("predoc-mention"),
    view: (v) => {
      const mv = new MentionView(v, ctx)
      setMentionView(mv)
      return mv
    },
  })
}
