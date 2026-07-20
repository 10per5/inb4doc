import { computeDiff, renderDiffHtml } from "@/components/ui/diff-viewer"
import { diffFrontmatter } from "@/entities/MetaDiff"
import { Frontmatter } from "@/entities/Frontmatter"
import { stripFrontmatter } from "@/utils/frontmatter"
import { BaseDialogController } from "./base-dialog-controller"

export const ChangesDialogEvent = {
  Discard:    "changes-dialog:discard",
  DiscardAll: "changes-dialog:discardAll",
  SaveAll:    "changes-dialog:saveAll",
  Done:       "changes-dialog:done",
  Reload:     "changes-dialog:reload",
  ReloadReady:"changes-dialog:reload-ready",
} as const

interface ChangeItem {
  path?: string
  currentPath?: boolean
  md?: string
  changeSize?: number
  sizeStr?: string
  sizeColor?: string
}

export class ChangesDialogController extends BaseDialogController {
  static targets = ["header", "changeItem", "pending", "preview"]
  static values = {
    changes: { type: Array, default: [] },
  }

  declare headerTarget: HTMLElement
  declare readonly changeItemTargets: HTMLElement[]
  declare readonly pendingTargets: HTMLElement[]
  declare readonly previewTargets: HTMLElement[]

  declare changesValue: ChangeItem[]

  togglePreview(e: Event) {
    const idx = (e.currentTarget as HTMLElement).dataset.idx
    if (idx === undefined) return
    const preview = this.previewTargets[parseInt(idx)]
    if (!preview) return
    const isOpen = preview.style.display === "block"
    preview.style.display = isOpen ? "none" : "block"

    if (!isOpen && !preview.hasChildNodes()) {
      this.loadPreview(parseInt(idx))
    }
  }

  loadPreview(idx: number) {
    const data = this.changesValue[idx]
    if (!data?.path) return

    // Ask the opener (via event) to fetch the original content for this path.
    this.dispatch("reload", { detail: { idx, path: data.path }, bubbles: true })
  }

  reloadReady(e: Event) {
    const { idx, text } = (e as CustomEvent<{ idx: number; text: string }>).detail
    const preview = this.previewTargets[idx]
    const data = this.changesValue[idx]
    if (!preview || !data?.path) return

    const original = text
    const current = data.md ?? ""

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

    preview.innerHTML = html || `<div style="padding:8px;color:#888;text-align:center">No changes</div>`
  }

  saveAll() {
    this.dispatch("saveAll", { bubbles: true })
    this.dispatch("done", { bubbles: true })
  }

  discardAll() {
    this.dispatch("discardAll", { bubbles: true })
    this.dispatch("done", { bubbles: true })
  }

  close() {
    this.dispatch("done", { bubbles: true })
  }

  discard(e: Event) {
    const path = (e.currentTarget as HTMLElement).dataset.discardPath
    if (!path) return
    this.dispatch("discard", { detail: path, bubbles: true })

    const item = (e.currentTarget as HTMLElement).closest(".inb4doc-changes-item")
    if (item) {
      item.remove()
      const remaining = this.changeItemTargets.length
      const pending = this.pendingTargets.length
      const parts = [`Unsaved Changes (${remaining})`]
      if (pending > 0) parts.push(`Pending Ops (${pending})`)
      this.headerTarget.textContent = parts.join(" — ")
      if (remaining === 0) {
        this.dispatch("done", { bubbles: true })
      }
    }
  }
}
