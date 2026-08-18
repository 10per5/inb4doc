import type { EditorView } from "prosemirror-view"
import type { EditorState } from "prosemirror-state"
import { pagesStore } from "@/stores/page-store"

export class MentionView {
  content: HTMLElement
  private view: EditorView
  private activeIndex = 0
  private handleKeydown: (e: KeyboardEvent) => void
  private mentionFrom: number | null = null
  private filterText = ""
  private visible = false

  constructor(view: EditorView) {
    this.view = view
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
        this.hide()
      }
    }

    document.addEventListener("keydown", this.handleKeydown, true)
  }

  update(view: EditorView, prevState?: EditorState) {
    this.view = view
    const { selection } = view.state
    const $from = selection.$from
    if ($from.parent.type.name !== "paragraph" && $from.parent.type.name !== "heading") {
      this.hide()
      return
    }
    const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC")
    if (!text.startsWith("@")) {
      this.hide()
      return
    }
    this.filterText = text.slice(1)
    this.renderItems(this.filterText)
    if (!this.visible) this.show()
    this.#position()
  }

  destroy() {
    document.removeEventListener("keydown", this.handleKeydown, true)
    this.hide()
  }

  show() {
    this.visible = true
    this.content.dataset.show = "true"
    this.mentionFrom = this.view.state.selection.from
  }

  hide() {
    this.visible = false
    this.content.dataset.show = "false"
  }

  #position() {
    const { selection } = this.view.state
    const coords = this.view.coordsAtPos(selection.from)
    const parent = this.content.parentElement
    if (parent) {
      this.content.style.left = `${coords.left}px`
      this.content.style.top = `${coords.bottom + 4}px`
    }
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
      const title = this.pageTitles[p] || pagesStore.getOrCreate(p).name
      return title.toLowerCase().includes(lowerFilter) || p.toLowerCase().includes(lowerFilter)
    })

    if (matching.length === 0) {
      this.hide()
      return
    }

    this.content.innerHTML = matching.map(p => {
      const title = this.pageTitles[p] || pagesStore.getOrCreate(p).name
      return `<div data-page="${p}" data-title="${title}">${title}</div>`
    }).join("")

    this.content.dataset.show = "true"
    this.activeIndex = 0
    const items = this.content.querySelectorAll<HTMLElement>("[data-page]")
    this.highlight(items)
  }

  private insertLink(pagePath: string, title: string) {
    const view = this.view
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
      this.hide()
      return
    }

    const atPos = $pos.start() + atIdx
    const node = nodeType.create({
      path: pagePath.replace(/\.md$/, ""),
      title,
    })

    view.dispatch(view.state.tr.replaceWith(atPos, from, node))
    view.focus()
    this.hide()
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background = i === this.activeIndex ? "var(--color-bg-tertiary)" : ""
    }
  }
}
