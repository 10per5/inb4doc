/**
 * Block-level content search.
 *
 * Results are reported per block (paragraph / heading / list item / table row /
 * code fence) with the heading trail above it, instead of one flat path-level
 * hit with raw-markdown snippets. That matches how the editor stores the
 * document (top-level nodes) and gives the sidebar enough context to show
 * "Setup › Install" and jump straight at the matched block.
 *
 * Pure string work — importable from both the browser bundle and the dev
 * server (`lib/endpoints.ts`), no ProseMirror dependency.
 */

import MarkdownIt from "markdown-it"

export interface SearchHit {
  /** Display text of the matched block, markdown markers stripped. */
  text: string
  /** Headings above the block, outermost first. */
  headingPath: string[]
}

const md = new MarkdownIt({ html: false, linkify: false })

/** Collapse a block to one line for the sidebar. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Render a markdown block as plain text for display/anchoring.
 *
 * Uses markdown-it's inline tokenizer rather than a stack of regexes so
 * emphasis, code spans, links and images (alt text) all come out right, and
 * raw HTML tags never leak into the result.
 */
export function markdownToText(raw: string): string {
  const source = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\[![A-Za-z]+\]\s*/, "")
    .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, "$1")
    .replace(/^\[[ xX]\]\s*/, "")

  let out = ""
  const walkInline = (tokens: readonly any[]) => {
    for (const token of tokens) {
      if (token.type === "text" || token.type === "code_inline") {
        out += token.content
      } else if (token.type === "softbreak" || token.type === "hardbreak") {
        out += " "
      } else if (token.type === "image") {
        out += token.content || ""
      } else if (token.children) {
        walkInline(token.children)
      }
    }
  }

  for (const token of md.parseInline(source, {})) {
    if (token.type === "inline") {
      walkInline(token.children ?? [])
    } else if (token.type === "fence" || token.type === "code_block") {
      out += token.content
    } else if (token.content) {
      out += token.content
    }
  }

  return oneLine(out)
}

/** Map legacy `snippets` payloads onto block hits (no heading context). */
export function hitsFromSnippets(snippets: readonly string[]): SearchHit[] {
  return snippets.map((snippet) => ({
    text: markdownToText(snippet) || oneLine(snippet),
    headingPath: [],
  }))
}

/** True when the raw markdown contains the query (cheap pre-filter). */
export function contentMatches(content: string, query: string): boolean {
  return content.toLowerCase().includes(query.toLowerCase().trim())
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const TABLE_ROW = /^\s*\|/
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|?\s*$/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/

/**
 * Extract up to `maxHits` matching blocks with their heading trails.
 *
 * Block splitting is line based (blank lines separate paragraphs, one block per
 * heading / list item / table row / fenced code block) because the search runs
 * over many files and must stay cheap — the editor schema is not involved.
 */
export function extractHits(
  content: string,
  query: string,
  maxHits = 3,
): SearchHit[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const lines = content.replace(/\r\n?/g, "\n").split("\n")
  const hits: SearchHit[] = []
  const headingTrail: string[] = []

  const pushBlock = (raw: string, display?: string) => {
    if (hits.length >= maxHits) return
    if (!raw.toLowerCase().includes(q)) return
    const text = display ?? markdownToText(raw)
    hits.push({
      // A query can match only markdown syntax (e.g. a link URL): fall back to
      // the raw block so the file still shows a useful row.
      text: text.toLowerCase().includes(q) ? text : oneLine(raw),
      headingPath: [...headingTrail],
    })
  }

  let i = 0
  while (i < lines.length && hits.length < maxHits) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE_OPEN.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const close = new RegExp(`^\\s*${marker}{3,}\\s*$`)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // closing fence
      pushBlock(body.join("\n"))
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      // The trail before this heading is the context for a hit on it.
      pushBlock(line, markdownToText(heading[2]))
      headingTrail[level - 1] = markdownToText(heading[2])
      headingTrail.length = level
      i++
      continue
    }

    if (TABLE_ROW.test(line)) {
      if (!TABLE_SEPARATOR.test(line)) {
        const cells = line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => markdownToText(cell))
        pushBlock(line, cells.join(" · "))
      }
      i++
      continue
    }

    const listItem = LIST_ITEM.exec(line)
    if (listItem) {
      const indent = listItem[1].length
      const body = [line]
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (!next.trim()) break
        const nextItem = LIST_ITEM.exec(next)
        if (nextItem && nextItem[1].length <= indent) break
        if (HEADING.test(next) || FENCE_OPEN.test(next) || TABLE_ROW.test(next)) break
        body.push(next)
        i++
      }
      pushBlock(body.join("\n"))
      continue
    }

    // Paragraph / blockquote run: consume until a blank line or a new block.
    const body = [line]
    i++
    while (i < lines.length) {
      const next = lines[i]
      if (!next.trim()) break
      if (FENCE_OPEN.test(next) || HEADING.test(next) || TABLE_ROW.test(next)) break
      body.push(next)
      i++
    }
    pushBlock(body.join("\n"))
  }

  return hits
}
