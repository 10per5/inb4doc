import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { Ctx } from "@milkdown/kit/ctx"
import { serializerCtx } from "@milkdown/kit/core"
import { pageRepository } from "@/repositories/pageRepository"

export interface DirtyPluginConfig {
  getLastSetContent: (path: string) => string
  setLastSetContent: (path: string, content: string) => void
  onDirtyChange?: (dirty: boolean) => void
  getCurrentPath: () => string
}

export function createDirtyPlugin(ctx: Ctx, config: DirtyPluginConfig) {
  return new Plugin({
    key: new PluginKey("inb4doc-dirty"),
    view: () => ({
      update: (view, prevState) => {
        if (!prevState) return
        const path = config.getCurrentPath()
        const prevLastSet = config.getLastSetContent(path)
        if (prevLastSet === "") {
          const serializer = ctx.get(serializerCtx)
          config.setLastSetContent(
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
        config.setLastSetContent(path, md)
        pageRepository.getOrCreate(path).setBody(md)
        pageRepository.save()
        config.onDirtyChange?.(true)
      },
    }),
  })
}
