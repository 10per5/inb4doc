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
    html += `<div style="padding:4px 8px;background:#e8e8e8;color:#333;font-size:0.7rem;font-weight:600;border-bottom:1px solid #ddd">METADATA CHANGES</div>`
    for (const entry of metaDiff) {
      const bg = entry.status === "added" ? "#d4edda" : entry.status === "removed" ? "#f8d7da" : "#fff3cd"
      const color = entry.status === "added" ? "#155724" : entry.status === "removed" ? "#721c24" : "#856404"
      const prefix = entry.status === "added" ? "+ " : entry.status === "removed" ? "- " : "~ "
      const valStr = entry.status === "removed"
        ? String(entry.oldVal ?? "")
        : entry.status === "added"
          ? String(entry.newVal ?? "")
          : `${entry.oldVal ?? ""} → ${entry.newVal ?? ""}`
      html += `<div style="background:${bg};color:${color};padding:2px 8px;white-space:pre-wrap">${prefix}${entry.key}: ${valStr}</div>`
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
    if (html) html += `<div style="height:4px;background:#fafafa"></div>`
    html += `<div style="padding:4px 8px;background:#e8e8e8;color:#333;font-size:0.7rem;font-weight:600;border-bottom:1px solid #ddd">CONTENT CHANGES</div>`
    html += renderDiffHtml(contextDiff)
  }

  return html || `<div style="padding:8px;color:#888;text-align:center">No changes</div>`
}
