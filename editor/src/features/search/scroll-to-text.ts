/**
 * scroll-to-text — DOM utilities for finding and highlighting text matches.
 *
 * Pure DOM — no Milkdown or ProseMirror imports.
 * ProseMirror selection is handled by editor-controller.
 */

import { findTextInProseMirror } from "@/features/search/prosemirror-search"

export interface TextMatch {
  node: Text
  offset: number
  rect: DOMRect | null
  length: number
}

/** Find a text match in the ProseMirror DOM. Pure DOM, no Milkdown. */
export function findTextMatch(
  query: string,
  matchIndex?: number,
  snippetText?: string,
): TextMatch | null {
  const q = query.toLowerCase().trim()
  if (!q) return null

  const result = findTextInProseMirror(q, matchIndex, snippetText)
  if (!result) return null

  const endOff = Math.min(
    result.offset + q.length,
    (result.node.textContent || "").length,
  )
  let rect: DOMRect | null = null
  try {
    const range = document.createRange()
    range.setStart(result.node, result.offset)
    range.setEnd(result.node, endOff)
    rect = range.getBoundingClientRect()
  } catch {
    rect = null
  }

  if (!rect || rect.width === 0) {
    const parent = result.node.parentElement
    if (parent) rect = parent.getBoundingClientRect()
  }

  return { node: result.node, offset: result.offset, rect, length: q.length }
}

/** Flash a highlight overlay at a position. Pure DOM. */
export function flashHighlight(rect: DOMRect): void {
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
}

/** Center viewport on a rect and scroll. Pure DOM. */
export function centerOnRect(rect: DOMRect): DOMRect {
  const viewportHeight = window.innerHeight
  const scrollEl = document.querySelector(".book-layout")
  const idealTop = Math.max(0, (viewportHeight - rect.height) / 2)
  if (Math.abs(rect.top - idealTop) > 2 && scrollEl) {
    scrollEl.scrollTop += rect.top - idealTop
  }
  return rect
}
