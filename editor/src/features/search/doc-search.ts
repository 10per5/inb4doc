/**
 * Document-model search.
 *
 * Finding a match by walking the rendered DOM (text nodes + `cleanMarkdown`
 * regexes) loses information: table cells, alerts and code fences don't line up
 * with their DOM text, duplicate snippets always land on the first occurrence,
 * and the caret has to be converted back through `posAtDOM`.
 *
 * Searching the ProseMirror document instead gives exact positions, the block
 * that owns the match, and the heading trail — which is also what the sidebar
 * now stores per hit.
 */

import type { Node as PMNode } from "prosemirror-model"

export interface DocTextMatch {
  from: number
  to: number
  /** Start position of the text block (paragraph/heading/code cell) holding the match. */
  blockFrom: number
  /** Plain text of that block (ProseMirror `textContent`). */
  blockText: string
  /** Headings above the block, outermost first. */
  headingPath: string[]
}

export interface PickMatchOptions {
  /** Block text from a search hit; used to pick the right duplicate. */
  blockText?: string
  /**
   * Heading trail from the clicked search hit, outermost first. Filters out
   * identical blocks that live under a different section.
   */
  headingPath?: string[]
  /** Global occurrence (find bar); used when there is no block hint. */
  matchIndex?: number
}

/** Letters/digits only — survives table separators and markdown punctuation. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

/** All occurrences of `query` in `doc`, in document order. */
export function findDocMatches(doc: PMNode, query: string): DocTextMatch[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const matches: DocTextMatch[] = []
  const trail: string[] = []

  doc.forEach((block, blockFrom) => {
    const context = [...trail]
    collectMatches(block, blockFrom, context, q, matches)

    if (block.type.name === "heading") {
      const level = Number(block.attrs.level ?? 1)
      trail[level - 1] = block.textContent.trim()
      trail.length = level
    }
  })

  return matches
}

/** Scan the nearest text block, recursing into containers (details, tables…). */
function collectMatches(
  block: PMNode,
  blockPos: number,
  headingPath: string[],
  query: string,
  out: DocTextMatch[],
): void {
  if (block.isTextblock) {
    const blockText = block.textContent
    block.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text ?? ""
      if (!text) return
      const lower = text.toLowerCase()
      let index = 0
      while ((index = lower.indexOf(query, index)) >= 0) {
        // `descendants` positions are relative to the block's content start;
        // +1 turns that into a document position (inside the block node).
        const from = blockPos + pos + index + 1
        out.push({
          from,
          to: from + query.length,
          blockFrom: blockPos,
          blockText,
          headingPath,
        })
        index += query.length
      }
    })
    return
  }

  if (block.isLeaf) return
  block.forEach((child, offset) => {
    if (child.isBlock) {
      collectMatches(child, blockPos + 1 + offset, headingPath, query, out)
    }
  })
}

/**
 * Pick the match the user asked for.
 *
 * Search hits carry the clicked block's text: prefer a match inside that block
 * (exact compact match first, then containment for nested blocks), and fall
 * back to the global occurrence used by the find bar.
 */
export function pickDocMatch(
  matches: readonly DocTextMatch[],
  options: PickMatchOptions = {},
): DocTextMatch | null {
  if (!matches.length) return null

  const index = options.matchIndex ?? 0
  let pool: readonly DocTextMatch[] = matches

  // A hit knows which section it belongs to. Same-text blocks in other
  // sections are different results, so don't let them win.
  if (options.headingPath?.length) {
    const trail = options.headingPath
    const sameSection = pool.filter(
      (m) =>
        m.headingPath.length === trail.length &&
        m.headingPath.every((heading, i) => heading === trail[i]),
    )
    if (sameSection.length) pool = sameSection
  }

  if (options.blockText) {
    const target = compact(options.blockText)
    if (target) {
      const exact = pool.filter((m) => compact(m.blockText) === target)
      if (exact.length) return exact[index] ?? exact[0]

      const nested = pool.filter((m) => {
        const text = compact(m.blockText)
        return text.includes(target) || target.includes(text)
      })
      if (nested.length) return nested[index] ?? nested[0]
    }
  }

  return pool[index] ?? pool[0]
}

/** Position range of a heading (by level + exact text), or null. */
export function findHeadingRange(
  doc: PMNode,
  text: string,
  level: number,
): { from: number; to: number } | null {
  const target = text.trim()
  if (!target) return null

  let found: { from: number; to: number } | null = null
  doc.forEach((block, offset) => {
    if (found || block.type.name !== "heading") return
    if (Number(block.attrs.level ?? 1) !== level) return
    if (block.textContent.trim() !== target) return
    found = { from: offset + 1, to: offset + 1 + block.content.size }
  })
  return found
}
