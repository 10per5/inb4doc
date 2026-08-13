import { computeDiff, renderDiffHtml } from "@/components/ui/diff-viewer"
import { diffFrontmatter } from "@/entities/MetaDiff"
import { Frontmatter } from "@/entities/Frontmatter"
import { stripFrontmatter } from "@/utils/frontmatter"

export function renderPendingDiff(original: string, current: string): string {
  const { frontmatter: origFm, body: origBody } = stripFrontmatter(original)
  const { frontmatter: currFm, body: currBody } = stripFrontmatter(current)

  const metaDiff = diffFrontmatter(
    origFm ? Frontmatter.fromMeta(origFm) : undefined,
    currFm ? Frontmatter.fromMeta(currFm) : undefined,
  )

  let html = ""
  if (metaDiff.length > 0) {
    html += `<div class="inb4doc-diff-header">METADATA CHANGES</div>`
    for (const entry of metaDiff) {
      const cls =
        entry.status === "added" ? "inb4doc-diff-add" :
        entry.status === "removed" ? "inb4doc-diff-del" :
        "inb4doc-diff-mod"
      const prefix = entry.status === "added" ? "+ " : entry.status === "removed" ? "- " : "~ "
      const valStr = entry.status === "removed"
        ? String(entry.oldVal ?? "")
        : entry.status === "added"
          ? String(entry.newVal ?? "")
          : `${entry.oldVal ?? ""} → ${entry.newVal ?? ""}`
      html += `<div class="inb4doc-diff-line ${cls}">${prefix}${entry.key}: ${valStr}</div>`
    }
  }

  const diff = computeDiff(origBody, currBody)
  const contextDiff = diff.filter((line, i) => {
    if (line.type !== "same") return true
    const prev = diff[i - 1]
    const next = diff[i + 1]
    return (prev && prev.type !== "same") || (next && next.type !== "same")
  })

  if (contextDiff.length > 0) {
    if (html) html += `<div class="inb4doc-diff-spacer"></div>`
    html += `<div class="inb4doc-diff-header">CONTENT CHANGES</div>`
    html += renderDiffHtml(contextDiff)
  }

  return html || `<div class="inb4doc-diff-empty">No changes</div>`
}
