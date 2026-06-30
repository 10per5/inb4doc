import { html, render } from "lit-html"
import { diffLines } from "diff"
import { miniWindow } from "../ui"
import { pressTwiceButton } from "./press-twice-button"
import { colors } from "../../theme"
import { formatBytes } from "../../utils/format"
import type { MetaPanelData } from "../panels/meta-panel"

function createOverlay(): HTMLDivElement {
  const existing = document.getElementById("predoc-dialog-overlay")
  if (existing) existing.remove()
  const overlay = document.createElement("div")
  overlay.id = "predoc-dialog-overlay"
  document.body.appendChild(overlay)
  return overlay
}

function escapeHtml(text: string): string {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

function parseFrontmatter(raw: string): MetaPanelData {
  const data: MetaPanelData = { title: "" }
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)/)
    if (m) {
      const val = m[2].trim()
      if (m[1] === "weight") data.weight = parseInt(val) || undefined
      else data[m[1]] = val
    }
  }
  return data
}

function stripFrontmatter(content: string): { frontmatter: MetaPanelData | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (match) {
    return { frontmatter: parseFrontmatter(match[1]), body: content.slice(match[0].length).replace(/^\n/, '') }
  }
  return { frontmatter: null, body: content }
}

export interface ChangesDialogData {
  path?: string
  currentPath?: boolean
  md?: string
  changeSize?: number
  isPendingOp?: boolean
  opLabel?: string
}

export interface ChangesDialogActions {
  onDiscard: (path: string) => void
  onNavigate: (path: string) => void
  onReload: (path: string) => Promise<string>
  onFlushAll: () => void
  onDiscardAll: () => void
}

export function mountChangesDialog(
  changes: ChangesDialogData[],
  currentPath: string,
  actions: ChangesDialogActions,
  onClose: () => void
) {
  const overlay = createOverlay()

  const itemStyles = `
    .predoc-changes-item {
      margin-bottom: 0.5rem; border: 1px solid #e5e9f0;
      border-radius: 4px; overflow: hidden;
    }
    .predoc-changes-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.6rem; border-bottom: 1px solid #e5e9f0;
    }
    .predoc-changes-path {
      flex: 1; padding: 0.4rem 0.6rem; cursor: pointer;
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.9rem; user-select: none;
    }
    .predoc-changes-preview {
      display: none; font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.75rem; background: #fafafa;
      border-top: 1px solid #e5e9f0; max-height: 300px; overflow-y: auto;
    }
    .predoc-changes-preview-line {
      padding: 2px 8px; white-space: pre-wrap; position: relative;
    }
    .predoc-changes-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
    .predoc-changes-actions button {
      padding: 0.4rem 1.2rem; border: 1px solid #d8dee9; border-radius: 4px;
      background: #fff; cursor: pointer; font-size: 0.9rem;
    }
    .predoc-changes-actions button:hover { background: #e5e9f0; }
    .predoc-dialog-close { padding: 0.4rem 1.2rem; border: 1px solid #d8dee9; border-radius: 4px; background: #fff; cursor: pointer; font-size: 0.9rem; }
  `

  const renderItem = (data: ChangesDialogData) => {
    if (data.isPendingOp) {
      return html`
        <div class="predoc-changes-item" style="opacity:0.85">
          <div class="predoc-changes-header" style="background:#fff8e1;border-left:3px solid #f0ad4e">
            <div class="predoc-changes-path" style="font-size:0.85rem;padding:0.3rem 0.6rem">
              <span style="color:#856404">${data.opLabel}</span>
            </div>
          </div>
        </div>
      `
    }

    const bgColor = data.currentPath ? "#eef4f9" : ""
    const size = data.changeSize ?? 0
    const sizeStr = formatBytes(size)
    const sizeColor = size > 0 ? colors.green : size < 0 ? colors.danger : colors.teal

    return html`
      <div class="predoc-changes-item">
        <div class="predoc-changes-header">
          <div class="predoc-changes-path" style="background: ${bgColor}">
            <span style="flex:1">${data.path}</span>
            <span style="color:${sizeColor};font-size:0.8rem">${sizeStr}</span>
          </div>
          <span class="predoc-discard-placeholder"></span>
        </div>
        <div class="predoc-changes-preview"></div>
      </div>
    `
  }

  const dirtyCount = changes.filter(c => !c.isPendingOp).length
  const pendingCount = changes.filter(c => c.isPendingOp).length
  const titleParts = [`Unsaved Changes (${dirtyCount})`]
  if (pendingCount > 0) titleParts.push(`Pending Ops (${pendingCount})`)

  const bodyTmpl = html`
    <style>${itemStyles}</style>
    ${changes.map(d => renderItem(d))}
  `
  const actionsTmpl = html`
    <button class="predoc-btn predoc-btn-primary" data-action="save-all">Save all</button>
    <span class="predoc-discard-all-placeholder"></span>
    <button class="predoc-btn" data-action="close">Close</button>
  `

  const tmpl = html`<style>${itemStyles}</style>${miniWindow(titleParts.join(" — "), bodyTmpl, actionsTmpl)}`

  render(tmpl, overlay)

  const windowEl = overlay.querySelector(".predoc-window") as HTMLElement
  const bodyEl = overlay.querySelector(".predoc-window-body") as HTMLElement

  changes.forEach((data, idx) => {
    const item = bodyEl.querySelectorAll(".predoc-changes-item")[idx] as HTMLElement
    const preview = item.querySelector(".predoc-changes-preview") as HTMLElement
    const header = item.querySelector(".predoc-changes-header") as HTMLElement

    // Skip pending ops — no click/dblclick/discard/reload interaction
    if (data.isPendingOp) return

    header!.addEventListener("click", () => {
      const isOpen = preview!.style.display === "block"
      preview!.style.display = isOpen ? "none" : "block"
    })

    header!.addEventListener("dblclick", () => {
      overlay.remove()
      onClose()
      actions.onNavigate(data.path!)
    })

    const placeholder = item.querySelector(".predoc-discard-placeholder") as HTMLElement
    let discardBtn: HTMLButtonElement
    discardBtn = pressTwiceButton({
      idleText: "Discard",
      pendingText: "Press again",
      variant: "danger",
      small: true,
      onConfirm: () => {
        actions.onDiscard(data.path!)
        const itemEl = discardBtn.closest(".predoc-changes-item")
        if (itemEl) {
          itemEl.remove()
          const remainingDirty = bodyEl.querySelectorAll(".predoc-changes-item:not([style*='opacity'])")
          const pending = bodyEl.querySelectorAll(".predoc-changes-item[style*='opacity']")
          const headerEl = windowEl.querySelector(".predoc-window-header")
          if (headerEl) {
            const parts = [`Unsaved Changes (${remainingDirty.length})`]
            if (pending.length > 0) parts.push(`Pending Ops (${pending.length})`)
            headerEl.textContent = parts.join(" — ")
          }
          if (remainingDirty.length === 0) {
            overlay.remove()
            onClose()
          }
        }
      },
    })
    placeholder.replaceWith(discardBtn)

    actions.onReload(data.path!).then((original) => {
      const origStripped = stripFrontmatter(original)
      const modStripped = stripFrontmatter(data.md!)

      let html = ""

      const origFm = origStripped.frontmatter || {} as MetaPanelData
      const modFm = modStripped.frontmatter || {} as MetaPanelData
      const allKeys = new Set([...Object.keys(origFm), ...Object.keys(modFm)])
      const changedKeys = [...allKeys].filter(k => origFm[k as keyof MetaPanelData] !== modFm[k as keyof MetaPanelData])

      if (changedKeys.length > 0) {
        html += `<div style="padding:4px 8px;background:#e8e8e8;color:#333;font-size:0.7rem;font-weight:600;border-bottom:1px solid #ddd">METADATA CHANGES</div>`
        for (const key of changedKeys.sort()) {
          const oldVal = origFm[key as keyof MetaPanelData]
          const newVal = modFm[key as keyof MetaPanelData]
          const isAdded = (oldVal === undefined || oldVal === "") && newVal !== undefined && newVal !== ""
          const isRemoved = (newVal === undefined || newVal === "") && oldVal !== undefined && oldVal !== ""
          const bg = isAdded ? "#d4edda" : isRemoved ? "#f8d7da" : "#fff3cd"
          const color = isAdded ? "#155724" : isRemoved ? "#721c24" : "#856404"
          const prefix = isAdded ? "+ " : isRemoved ? "- " : "~ "
          const valStr = isRemoved ? escapeHtml(String(oldVal)) : isAdded ? escapeHtml(String(newVal)) : `${escapeHtml(String(oldVal))} \u2192 ${escapeHtml(String(newVal))}`
          html += `<div style="background:${bg};color:${color};padding:2px 8px;white-space:pre-wrap">${prefix}${escapeHtml(key)}: ${valStr}</div>`
        }
      }

      const lineDiff = diffLines(origStripped.body, modStripped.body)
      const diffLinesArr: Array<{type: "same" | "added" | "removed"; text: string}> = []
      for (const part of lineDiff) {
        const lines = part.value.split('\n')
        const type: "same" | "added" | "removed" = part.added ? "added" : part.removed ? "removed" : "same"
        for (let i = 0; i < lines.length - 1; i++) {
          diffLinesArr.push({ type, text: lines[i] })
        }
      }
      const bodyChanges = diffLinesArr.filter((line, i) => {
        if (line.type !== "same") return true
        const prev = diffLinesArr[i - 1]
        const next = diffLinesArr[i + 1]
        return (prev && prev.type !== "same") || (next && next.type !== "same")
      })

      if (bodyChanges.length > 0) {
        if (html) html += `<div style="height:4px;background:#fafafa"></div>`
        html += `<div style="padding:4px 8px;background:#e8e8e8;color:#333;font-size:0.7rem;font-weight:600;border-bottom:1px solid #ddd">CONTENT CHANGES</div>`
        const limited = bodyChanges.slice(0, 100)
        let origLineNum = 0
        html += limited.map(line => {
          const bg = line.type === "added" ? "#d4edda" : line.type === "removed" ? "#f8d7da" : "#fafafa"
          const color = line.type === "added" ? "#155724" : line.type === "removed" ? "#721c24" : "#555"
          const prefix = line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "
          const lineNum = line.type !== "added" ? ++origLineNum : null
          const jumpBtn = lineNum ? `<button data-jump="${data.path}:${lineNum}" style="float:right;padding:1px 6px;font-size:0.65rem;cursor:pointer;background:#5e81ac;color:#fff;border:none;border-radius:3px;opacity:0;transition:opacity 0.15s">Jump</button>` : ""
          return `<div data-line="${lineNum ?? ''}" style="background:${bg};color:${color};padding:2px 8px;white-space:pre-wrap;position:relative;cursor:${lineNum ? 'pointer' : 'default'}">${prefix}${escapeHtml(line.text)}${jumpBtn}</div>`
        }).join("")
        if (bodyChanges.length > 100) {
          html += `<div style="padding:4px 8px;color:#888;font-style:italic">... and ${bodyChanges.length - 100} more lines</div>`
        }
      }

      preview!.innerHTML = html || `<div style="padding:8px;color:#888;text-align:center">No changes</div>`

      preview!.querySelectorAll("[data-line]").forEach((el) => {
        const lineDiv = el as HTMLElement
        const jumpBtn = lineDiv.querySelector("[data-jump]") as HTMLElement
        if (jumpBtn) {
          lineDiv.addEventListener("mouseenter", () => {
            jumpBtn.style.opacity = "1"
            lineDiv.style.background = lineDiv.style.background === "#d4edda" ? "#c3e6cb" : lineDiv.style.background === "#f8d7da" ? "#f1b0b7" : "#e9ecef"
          })
          lineDiv.addEventListener("mouseleave", () => {
            jumpBtn.style.opacity = "0"
            const lineType = lineDiv.textContent?.startsWith("+") ? "added" : lineDiv.textContent?.startsWith("-") ? "removed" : "same"
            lineDiv.style.background = lineType === "added" ? "#d4edda" : lineType === "removed" ? "#f8d7da" : "#fafafa"
          })
          jumpBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            const jumpTarget = (jumpBtn as HTMLElement).dataset.jump
            if (jumpTarget) {
              const [targetPath, lineStr] = jumpTarget.split(":")
              const lineNum = parseInt(lineStr)
              overlay.remove()
              onClose()
              actions.onNavigate(targetPath)
              setTimeout(() => {
                const editorEl = document.getElementById("milkdown-editor")
                if (editorEl) {
                  editorEl.scrollTop = (lineNum - 1) * 20
                }
              }, 100)
            }
          })
        }
      })
    }).catch(() => {
      preview!.textContent = (data.md ?? "").slice(0, 500) + ((data.md ?? "").length > 500 ? "\n..." : "")
    })
  })

  const closeDialog = () => {
    overlay.remove()
    onClose()
  }

  (overlay.querySelector('[data-action="save-all"]') as HTMLElement).addEventListener("click", () => {
    actions.onFlushAll()
    closeDialog()
  })

  const discardAllPlaceholder = overlay.querySelector(".predoc-discard-all-placeholder") as HTMLElement;
  let discardAllBtn: HTMLButtonElement;
  discardAllBtn = pressTwiceButton({
    idleText: "Discard all",
    pendingText: "Press again",
    variant: "danger",
    onConfirm: () => {
      actions.onDiscardAll()
      closeDialog()
    },
  });
  discardAllPlaceholder.replaceWith(discardAllBtn);

  (overlay.querySelector('[data-action="close"]') as HTMLElement).addEventListener("click", closeDialog)

  overlay.addEventListener("click", closeDialog)

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDialog()
      document.removeEventListener("keydown", onEsc)
    }
  }
  document.addEventListener("keydown", onEsc)
}
