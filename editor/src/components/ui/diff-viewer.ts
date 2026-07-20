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
    return `<div style="padding:8px;color:#888;text-align:center;font-size:0.8rem">No differences</div>`
  }
  const limited = lines.slice(0, maxLines)
  let html = ""
  for (const line of limited) {
    const bg = line.type === "added" ? "#d4edda" : line.type === "removed" ? "#f8d7da" : "#fafafa"
    const color = line.type === "added" ? "#155724" : line.type === "removed" ? "#721c24" : "#555"
    const prefix = line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "
    html += `<div class="inb4doc-diff-line" style="background:${bg};color:${color}">${prefix}${escapeHtml(line.text)}</div>`
  }
  if (lines.length > maxLines) {
    html += `<div style="padding:4px 8px;color:#888;font-style:italic;font-size:0.75rem">... and ${lines.length - maxLines} more lines</div>`
  }
  return html
}
