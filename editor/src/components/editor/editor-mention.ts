import { SlashProvider } from "@milkdown/kit/plugin/slash"
import type { EditorView } from "@milkdown/kit/prose/view"
import type { EditorState } from "@milkdown/kit/prose/state"
import { editorViewCtx } from "@milkdown/kit/core"
import type { Ctx } from "@milkdown/kit/ctx"

export class MentionView {
  provider: SlashProvider
  content: HTMLElement
  private view: EditorView
  private milkdownCtx: Ctx
  private activeIndex = 0
  private handleKeydown: (e: KeyboardEvent) => void
  private mentionFrom: number | null = null
  private filterText = ""

  constructor(view: EditorView, ctx: Ctx) {
    this.view = view
    this.milkdownCtx = ctx
    this.content = document.createElement("div")
    this.content.className = "milkdown-mention"
    this.content.dataset.show = "false"

    this.content.addEventListener("mousedown", (e) => {
      const item = (e.target as HTMLElement).closest("[data-page]") as HTMLElement
      if (!item) return
      e.preventDefault()
      this.insertLink(item.dataset.page!, item.dataset.title || item.dataset.page!)
    })

    this.handleKeydown = (e: KeyboardEvent) => {
      if (this.content.dataset.show !== "true") return
      const items = this.content.querySelectorAll<HTMLElement>("[data-page]")
      if (items.length === 0) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        this.activeIndex = (this.activeIndex + 1) % items.length
        this.highlight(items)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        this.activeIndex = (this.activeIndex - 1 + items.length) % items.length
        this.highlight(items)
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        const item = items[this.activeIndex]
        if (item) this.insertLink(item.dataset.page!, item.dataset.title || item.dataset.page!)
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        this.provider.hide()
      }
    }

    document.addEventListener("keydown", this.handleKeydown, true)

    const self = this
    this.provider = new SlashProvider({
      content: this.content,
      shouldShow(view) {
        const text = (this as any).getContent(view, (node: any) =>
          ["paragraph", "heading"].includes(node.type.name)
        )
        if (text == null) return false
        if (!text.startsWith("@")) return false
        self.filterText = text.slice(1)
        self.renderItems(self.filterText)
        return true
      },
    })

    this.provider.onShow = () => {
      this.mentionFrom = this.view.state.selection.from
    }
  }

  update(view: EditorView, prevState?: EditorState) {
    this.view = view
    this.provider.update(view, prevState)
  }

  destroy() {
    document.removeEventListener("keydown", this.handleKeydown, true)
    this.provider.destroy()
  }

  private pageList: string[] = []
  private pageTitles: Record<string, string> = {}

  setPages(pages: string[], titles: Record<string, string>) {
    this.pageList = pages
    this.pageTitles = titles
  }

  private renderItems(filter: string) {
    const lowerFilter = filter.toLowerCase()
    const matching = this.pageList.filter(p => {
      const title = this.pageTitles[p] || p.replace(/\//g, " ").replace(/-/g, " ").replace(/\.md$/, "")
      return title.toLowerCase().includes(lowerFilter) || p.toLowerCase().includes(lowerFilter)
    })

    if (matching.length === 0) {
      this.content.dataset.show = "false"
      this.provider.hide()
      return
    }

    this.content.innerHTML = matching.map(p => {
      const title = this.pageTitles[p] || p.replace(/\//g, " / ").replace(/-/g, " ").replace(/\.md$/, "")
      return `<div data-page="${p}" data-title="${title}">${title}</div>`
    }).join("")

    this.content.dataset.show = "true"
    this.activeIndex = 0
    const items = this.content.querySelectorAll<HTMLElement>("[data-page]")
    this.highlight(items)
  }

  private insertLink(pagePath: string, title: string) {
    const view = this.milkdownCtx.get(editorViewCtx)
    const nodeType = view.state.schema.nodes.hugoRef

    const { from } = view.state.selection
    const $pos = view.state.doc.resolve(from)
    const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "\uFFFC")
    const atIdx = textBefore.lastIndexOf("@")

    if (!nodeType || atIdx === -1) {
      if (this.mentionFrom != null && this.mentionFrom > 0) {
        view.dispatch(view.state.tr.delete(this.mentionFrom - 1, this.mentionFrom))
      }
      const link = `[${title}](/${pagePath.replace(/\.md$/, "")}) `
      view.dispatch(view.state.tr.insertText(link))
      view.focus()
      this.provider.hide()
      return
    }

    const atPos = $pos.start() + atIdx
    const node = nodeType.create({
      path: pagePath.replace(/\.md$/, ""),
      title,
    })

    view.dispatch(view.state.tr.replaceWith(atPos, from, node))
    view.focus()
    this.provider.hide()
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background = i === this.activeIndex ? "#e5e9f0" : ""
    }
  }
}
