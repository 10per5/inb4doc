import type { EditorView } from "prosemirror-view"
import type { EditorState } from "prosemirror-state"
import { treeStore } from "@/stores/tree-store"

function formatMentionPath(path: string, max = 40): string {
  const parts = path.split("/")
  const file = parts[parts.length - 1]
  const dirs = parts.slice(0, -1)
  if (dirs.length <= 1) return path
  if (path.length <= max) return path
  const withLastDir = `${dirs[0]}/.../${dirs[dirs.length - 1]}/${file}`
  if (withLastDir.length <= max) return withLastDir
  return `${dirs[0]}/.../${file}`
}

export class MentionView {
  content: HTMLElement
  private view: EditorView
  private activeIndex = 0
  private handleKeydown: (e: KeyboardEvent) => void
  private mentionFrom: number | null = null
  private visible = false

  constructor(view: EditorView) {
    this.view = view
    this.content = document.createElement("div")
    this.content.className = "inb4doc-mention"
    this.content.dataset.show = "false"
    ;(view.dom.parentNode as Element | null)?.appendChild(this.content)

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

  update(view: EditorView, _prevState?: EditorState) {
    this.view = view
    const { selection } = view.state
    const $from = selection.$from
    if (
      $from.parent.type.name !== "paragraph" &&
      $from.parent.type.name !== "heading"
    ) {
      this.hide()
      return
    }
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC")
    const match = /(?:^|\s)@([^\s@]*)$/.exec(textBefore)
    if (!match) {
      this.hide()
      return
    }
    const query = match[1]
    const atIndex = textBefore.length - query.length - 1
    this.mentionFrom = $from.start() + atIndex
    this.renderItems(query)
    if (this.visible) this.#position()
  }

  destroy() {
    document.removeEventListener("keydown", this.handleKeydown, true)
    this.content.remove()
    this.hide()
  }

  show() {
    this.visible = true
    this.content.dataset.show = "true"
    if (this.mentionFrom == null) {
      this.mentionFrom = this.view.state.selection.from
    }
  }

  hide() {
    this.visible = false
    this.mentionFrom = null
    this.content.dataset.show = "false"
  }

  #position() {
    const { selection } = this.view.state
    const coords = this.view.coordsAtPos(selection.from)
    const parent = this.content.parentElement
    if (parent) {
      const parentRect = parent.getBoundingClientRect()
      this.content.style.left = `${coords.left - parentRect.left}px`
      this.content.style.top = `${coords.bottom - parentRect.top + 4}px`
    }
  }

  private pageCandidates(): { path: string; title: string }[] {
    return Array.from(treeStore.getTree().paths).map((p) => ({
      path: p,
      title: p.split("/").pop()!.replace(/\.md$/, ""),
    }))
  }

  private renderItems(filter: string) {
    const lower = filter.toLowerCase()
    const candidates = this.pageCandidates().filter(
      (c) =>
        !lower ||
        c.title.toLowerCase().includes(lower) ||
        c.path.toLowerCase().includes(lower),
    )

    if (candidates.length === 0) {
      this.hide()
      return
    }

    this.content.innerHTML = candidates
      .map(
        (c) =>
          `<div class="mention-item" data-page="${c.path}" data-title="${c.title}" title="${c.path}">${formatMentionPath(c.path)}</div>`,
      )
      .join("")
    this.content.dataset.show = "true"
    this.visible = true
    this.activeIndex = 0
    this.highlight(this.content.querySelectorAll<HTMLElement>("[data-page]"))
  }

  private insertLink(pagePath: string, title: string) {
    const view = this.view
    const nodeType = view.state.schema.nodes.hugoRef
    const from = view.state.selection.from
    const atPos = this.mentionFrom

    if (nodeType && atPos != null) {
      const node = nodeType.create({
        path: pagePath.replace(/\.md$/, ""),
        title,
      })
      const tr = view.state.tr.replaceWith(atPos, from, node)
      tr.insertText(" ", atPos + node.nodeSize)
      view.dispatch(tr)
    } else if (atPos != null) {
      view.dispatch(view.state.tr.delete(atPos, from))
    }

    view.focus()
    this.hide()
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background =
        i === this.activeIndex ? "var(--color-bg-tertiary)" : ""
    }
  }
}
