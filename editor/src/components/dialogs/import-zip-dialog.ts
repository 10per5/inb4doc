import { html, render } from "lit-html"
import { miniWindow } from "@/components/ui/ui-helpers"
import type { ZipFileEntry } from "@/utils/zip"

export interface ImportDialogResult {
  selected: ZipFileEntry[]
}

export function mountImportZipDialog(
  entries: ZipFileEntry[],
  onImport: (result: ImportDialogResult) => void,
  onCancel: () => void,
) {
  const overlayId = "inb4doc-import-zip-overlay-" + Math.random().toString(36).slice(2)
  const overlay = document.createElement("div")
  overlay.id = overlayId
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center"
  document.body.appendChild(overlay)

  const close = () => {
    overlay.remove()
    onCancel()
  }

  const newEntries = entries.filter(e => !e.exists)
  const replaceEntries = entries.filter(e => e.exists)

  const bodyTmpl = html`
    <style>
      .import-file-row {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 0; font-size: 0.85rem;
        border-bottom: 1px solid var(--color-border);
      }
      .import-file-row:last-child { border-bottom: none; }
      .import-file-row input { margin: 0; flex-shrink: 0; }
      .import-file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary); }
      .import-file-badge {
        font-size: 0.7rem; padding: 1px 6px; border-radius: 3px;
        font-weight: 600; flex-shrink: 0;
      }
      .import-file-badge.new { background: #d4edda; color: #155724; }
      .import-file-badge.replace { background: #fff3cd; color: #856404; }
    </style>
    ${newEntries.length > 0 ? html`
      <div style="font-size:0.75rem;font-weight:600;color:var(--color-text-tertiary);padding:4px 0 2px;text-transform:uppercase;letter-spacing:0.5px">New files</div>
      ${newEntries.map((e, i) => html`
        <label class="import-file-row">
          <input type="checkbox" checked data-idx="${i}" data-type="new">
          <span class="import-file-path">${e.relPath}</span>
          <span class="import-file-badge new">New</span>
        </label>
      `)}
    ` : ""}
    ${replaceEntries.length > 0 ? html`
      <div style="font-size:0.75rem;font-weight:600;color:var(--color-text-tertiary);padding:8px 0 2px;text-transform:uppercase;letter-spacing:0.5px">Will replace</div>
      ${replaceEntries.map((e, i) => html`
        <label class="import-file-row">
          <input type="checkbox" data-idx="${i}" data-type="replace">
          <span class="import-file-path">${e.relPath}</span>
          <span class="import-file-badge replace">Replace</span>
        </label>
      `)}
    ` : ""}
  `

  const actionsTmpl = html`
    <label style="display:flex;align-items:center;gap:6px;margin-right:auto;font-size:0.85rem;cursor:pointer">
      <input type="checkbox" id="replace-all-check"> Replace all
    </label>
    <button class="inb4doc-btn inb4doc-btn-primary" id="import-btn">Import</button>
    <button class="inb4doc-btn" id="cancel-btn">Cancel</button>
  `

  const tmpl = html`
    <style>
      #overlay-id { position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center; }
      .inb4doc-window { background:var(--color-bg-primary);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;flex-direction:column;max-height:80vh;min-width:420px;max-width:520px; }
      .inb4doc-window-header { padding:1rem 1.5rem 0;font-size:1.1rem;font-weight:600;flex-shrink:0;color:var(--color-text-primary); }
      .inb4doc-window-body { padding:0.5rem 1.5rem;overflow-y:auto;flex:1;color:var(--color-text-primary); }
      .inb4doc-window-actions { display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.5rem 1rem;flex-shrink:0;align-items:center; }
      .inb4doc-btn { padding:0.4rem 1.2rem;border-radius:4px;cursor:pointer;font-size:0.9rem;border:1px solid var(--color-border);background:var(--color-bg-primary);color:var(--color-text-primary); }
      .inb4doc-btn:hover { background:var(--color-bg-tertiary); }
      .inb4doc-btn.inb4doc-btn-primary { background:var(--color-accent);color:#fff;border-color:var(--color-accent); }
      .inb4doc-btn.inb4doc-btn-primary:hover { background:var(--color-accent-hover); }
      .inb4doc-btn:disabled { opacity:0.5;cursor:default; }
    </style>
    <div class="inb4doc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <div class="inb4doc-window-header">Import from Zip</div>
      <div class="inb4doc-window-body">${bodyTmpl}</div>
      <div class="inb4doc-window-actions">${actionsTmpl}</div>
    </div>
  `

  render(tmpl, overlay)

  const newCount = newEntries.length
  const replaceCount = replaceEntries.length

  const updateImportBtn = () => {
    const checked = overlay.querySelectorAll<HTMLInputElement>('.import-file-row input[type="checkbox"]:checked')
    const btn = overlay.querySelector("#import-btn") as HTMLButtonElement
    btn.disabled = checked.length === 0
  }

  overlay.querySelectorAll<HTMLInputElement>('.import-file-row input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const replaceAll = overlay.querySelector("#replace-all-check") as HTMLInputElement
      if (cb.dataset.type === "replace" && !cb.checked) {
        replaceAll.checked = false
      }
      updateImportBtn()
    })
  })

  const replaceAllCheck = overlay.querySelector("#replace-all-check") as HTMLInputElement
  replaceAllCheck.addEventListener("change", () => {
    const replaceCbs = overlay.querySelectorAll<HTMLInputElement>('.import-file-row input[data-type="replace"]')
    replaceCbs.forEach(cb => { cb.checked = replaceAllCheck.checked })
    updateImportBtn()
  })

  const importBtn = overlay.querySelector("#import-btn") as HTMLButtonElement
  importBtn.addEventListener("click", () => {
    const selected: ZipFileEntry[] = []
    overlay.querySelectorAll<HTMLInputElement>('.import-file-row input[type="checkbox"]:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx!)
      const type = cb.dataset.type!
      const entry = type === "new" ? newEntries[idx] : replaceEntries[idx]
      if (entry) selected.push(entry)
    })
    overlay.remove()
    onImport({ selected })
  })

  const cancelBtn = overlay.querySelector("#cancel-btn") as HTMLButtonElement
  cancelBtn.addEventListener("click", close)

  overlay.addEventListener("click", close)
}
