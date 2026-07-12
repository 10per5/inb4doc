/**
 * scrollToText — find and scroll to a text match in the ProseMirror editor.
 *
 * Self-contained utility: locates the match via prosemirror-search,
 * sets the ProseMirror selection, and flashes the matched text.
 */

import type { Editor } from "@milkdown/kit/core"
import { editorViewCtx } from "@milkdown/kit/core"
import { TextSelection } from "@milkdown/kit/prose/state"
import { findTextInProseMirror } from "@/features/search/prosemirror-search"

export function scrollToText(
  editor: Editor,
  query: string,
  matchIndex?: number,
  snippetText?: string,
): void {
  const q = query.toLowerCase().trim()
  if (!q) return

  const result = findTextInProseMirror(q, matchIndex, snippetText)
  if (!result) return

  const proseMirror = document.querySelector(".ProseMirror")
  if (!proseMirror) return
  ;(proseMirror as HTMLElement).focus()

  requestAnimationFrame(() => {
    const range = document.createRange()
    const endOff = Math.min(
      result.offset + q.length,
      (result.node.textContent || "").length,
    )
    let rect: DOMRect | null = null
    try {
      range.setStart(result.node, result.offset)
      range.setEnd(result.node, endOff)
      rect = range.getBoundingClientRect()
    } catch {
      rect = null
    }

    // Set ProseMirror selection at match
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = view.posAtDOM(result.node, result.offset)
      if (pos == null) return
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc, pos, pos + q.length),
      )
      view.dispatch(tr)
    })

    if (!rect || rect.width === 0) {
      const parent = result.node.parentElement
      if (parent) rect = parent.getBoundingClientRect()
    }
    if (!rect) return

    const viewportHeight = window.innerHeight
    const scrollEl = document.querySelector(".book-layout")
    const idealTop = Math.max(0, (viewportHeight - rect.height) / 2)
    if (Math.abs(rect.top - idealTop) > 2 && scrollEl) {
      scrollEl.scrollTop += rect.top - idealTop
      rect = range.getBoundingClientRect()
    }

    // Flash highlight
    const flash = document.createElement("div")
    flash.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: var(--color-warning);
      opacity: 0.5;
      border-radius: 3px;
      pointer-events: none;
      z-index: 9999;
      transition: opacity 0.7s ease;
    `
    document.body.appendChild(flash)
    requestAnimationFrame(() => {
      flash.style.opacity = "0"
    })
    setTimeout(() => flash.remove(), 800)
  })
}
