import { diffLines } from "diff"

export interface DiffLine {
  type: "same" | "added" | "removed"
  text: string
}

export function computeDiff(local: string, disk: string): DiffLine[] {
  const lineDiff = diffLines(local, disk)
  const result: DiffLine[] = []
  for (const part of lineDiff) {
    const lines = part.value.split("\n")
    const type: "same" | "added" | "removed" =
      part.added ? "added" : part.removed ? "removed" : "same"
    for (let i = 0; i < lines.length - 1; i++) {
      result.push({ type, text: lines[i] })
    }
  }
  return result
}

function escapeHtml(text: string): string {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

export function renderDiffHtml(lines: DiffLine[], maxLines = 100): string {
  if (lines.length === 0) {
    return `<div class="inb4doc-diff-empty">No differences</div>`
  }
  const limited = lines.slice(0, maxLines)
  let html = ""
  for (const line of limited) {
    const cls =
      line.type === "added" ? "inb4doc-diff-add" :
      line.type === "removed" ? "inb4doc-diff-del" :
      "inb4doc-diff-ctx"
    const prefix = line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "
    html += `<div class="inb4doc-diff-line ${cls}">${prefix}${escapeHtml(line.text)}</div>`
  }
  if (lines.length > maxLines) {
    html += `<div class="inb4doc-diff-more">... and ${lines.length - maxLines} more lines</div>`
  }
  return html
}
