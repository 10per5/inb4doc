import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { Ctx } from "@milkdown/kit/ctx"
import { serializerCtx } from "@milkdown/kit/core"
import { cache } from "@/stores/cache"

export interface DirtyPluginConfig {
  lastSetContent: Map<string, string>
  currentPath: string
  onDirtyChange?: (dirty: boolean) => void
  getCurrentPath: () => string
}

export function createDirtyPlugin(ctx: Ctx, config: DirtyPluginConfig) {
  return new Plugin({
    key: new PluginKey("predoc-dirty"),
    view: () => ({
      update: (view, prevState) => {
        if (!prevState) return
        const path = config.getCurrentPath()
        const prevLastSet = config.lastSetContent.get(path) ?? ""
        if (prevLastSet === "") {
          const serializer = ctx.get(serializerCtx)
          config.lastSetContent.set(
            path,
            serializer(view.state.doc)
              .replace(/\r\n/g, "\n")
              .replace(/\n+$/, "\n"),
          )
          return
        }
        if (view.state.doc.eq(prevState.doc)) return
        const serializer = ctx.get(serializerCtx)
        const md = serializer(view.state.doc)
          .replace(/\r\n/g, "\n")
          .replace(/\n+$/, "\n")
        if (md === prevLastSet) return
        config.lastSetContent.set(path, md)
        cache.setBody(path, md)
        cache.sync()
        config.onDirtyChange?.(true)
      },
    }),
  })
}
