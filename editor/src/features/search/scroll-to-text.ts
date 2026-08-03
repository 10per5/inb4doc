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
  highlightLength?: number
  /** When set, the flash covers the whole element (e.g. a full heading) instead of a text span. */
  element?: Element
}

/**
 * Compute the current viewport rect for a match. This is a separate helper so
 * the rect can be recomputed *after* scrolling (rect coords change as the
 * `.book-layout` container scrolls). Pure DOM, no Milkdown.
 */
export function matchRect(match: TextMatch): DOMRect | null {
  if (match.element) {
    try {
      const range = document.createRange()
      range.selectNodeContents(match.element)
      return range.getBoundingClientRect()
    } catch {
      return match.element.getBoundingClientRect()
    }
  }

  const span = Math.max(match.highlightLength ?? match.length, 1)
  const endOff = Math.min(
    match.offset + span,
    (match.node.textContent || "").length,
  )
  let rect: DOMRect | null = null
  try {
    const range = document.createRange()
    range.setStart(match.node, match.offset)
    range.setEnd(match.node, endOff)
    rect = range.getBoundingClientRect()
  } catch {
    rect = null
  }

  if (!rect || rect.width === 0) {
    const parent = match.node.parentElement
    if (parent) rect = parent.getBoundingClientRect()
  }

  return rect
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

  const match: TextMatch = {
    node: result.node,
    offset: result.offset,
    rect: null,
    length: q.length,
  }
  match.rect = matchRect(match)
  return match
}

function getFirstTextNode(root: Node): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  return walker.nextNode() ? (walker.currentNode as Text) : null
}

/** Find a heading in the ProseMirror DOM by level + exact text. Pure DOM, no Milkdown. */
export function findHeadingTarget(
  text: string,
  level: number,
): TextMatch | null {
  const pm = document.querySelector(".ProseMirror")
  if (!pm) return null
  const target = text.trim()
  if (!target) return null
  const tag = `H${level}`
  const el = Array.from(
    pm.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ).find(
    (h) => h.tagName === tag && (h.textContent || "").trim() === target,
  )
  if (!el) return null
  const node = getFirstTextNode(el)
  if (!node) return null

  const match: TextMatch = {
    node,
    offset: 0,
    rect: null,
    length: 0,
    element: el,
  }
  match.rect = matchRect(match)

  return match
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
