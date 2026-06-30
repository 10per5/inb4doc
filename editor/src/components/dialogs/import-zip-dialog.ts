import { html, render } from "lit-html"
import { miniWindow } from "../ui"
import type { ZipFileEntry } from "../../utils/zip"

export interface ImportDialogResult {
  selected: ZipFileEntry[]
}

export function mountImportZipDialog(
  entries: ZipFileEntry[],
  onImport: (result: ImportDialogResult) => void,
  onCancel: () => void,
) {
  const overlayId = "predoc-import-zip-overlay-" + Math.random().toString(36).slice(2)
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
        border-bottom: 1px solid #e5e9f0;
      }
      .import-file-row:last-child { border-bottom: none; }
      .import-file-row input { margin: 0; flex-shrink: 0; }
      .import-file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .import-file-badge {
        font-size: 0.7rem; padding: 1px 6px; border-radius: 3px;
        font-weight: 600; flex-shrink: 0;
      }
      .import-file-badge.new { background: #d4edda; color: #155724; }
      .import-file-badge.replace { background: #fff3cd; color: #856404; }
    </style>
    ${newEntries.length > 0 ? html`
      <div style="font-size:0.75rem;font-weight:600;color:#888;padding:4px 0 2px;text-transform:uppercase;letter-spacing:0.5px">New files</div>
      ${newEntries.map((e, i) => html`
        <label class="import-file-row">
          <input type="checkbox" checked data-idx="${i}" data-type="new">
          <span class="import-file-path">${e.relPath}</span>
          <span class="import-file-badge new">New</span>
        </label>
      `)}
    ` : ""}
    ${replaceEntries.length > 0 ? html`
      <div style="font-size:0.75rem;font-weight:600;color:#888;padding:8px 0 2px;text-transform:uppercase;letter-spacing:0.5px">Will replace</div>
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
    <button class="predoc-btn predoc-btn-primary" id="import-btn">Import</button>
    <button class="predoc-btn" id="cancel-btn">Cancel</button>
  `

  const tmpl = html`
    <style>
      #overlay-id { position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center; }
      .predoc-window { background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;flex-direction:column;max-height:80vh;min-width:420px;max-width:520px; }
      .predoc-window-header { padding:1rem 1.5rem 0;font-size:1.1rem;font-weight:600;flex-shrink:0; }
      .predoc-window-body { padding:0.5rem 1.5rem;overflow-y:auto;flex:1; }
      .predoc-window-actions { display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.5rem 1rem;flex-shrink:0;align-items:center; }
      .predoc-btn { padding:0.4rem 1.2rem;border-radius:4px;cursor:pointer;font-size:0.9rem;border:1px solid #d8dee9;background:#fff;color:#4c566a; }
      .predoc-btn:hover { background:#e5e9f0; }
      .predoc-btn.predoc-btn-primary { background:#5e81ac;color:#fff;border-color:#5e81ac; }
      .predoc-btn.predoc-btn-primary:hover { background:#4a7098; }
      .predoc-btn:disabled { opacity:0.5;cursor:default; }
    </style>
    <div class="predoc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <div class="predoc-window-header">Import from Zip</div>
      <div class="predoc-window-body">${bodyTmpl}</div>
      <div class="predoc-window-actions">${actionsTmpl}</div>
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
