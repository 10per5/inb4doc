import { html, render } from "lit-html"
import { listImages, deleteImage, getCurrentDocDir, getAllImages } from "../../services/image-config"
import { showToast } from "../toast/toast"

export async function mountImageManagerDialog(): Promise<void> {
  const dir = getCurrentDocDir()

  // Fetch data first, then render once — avoids stale "Loading…" text
  let entries: Awaited<ReturnType<typeof listImages>> = []
  let loadError: string | null = null
  try {
    entries = await listImages(true)
  } catch (e: any) {
    loadError = e.message
  }

  const allEntries = getAllImages()

  const overlayId = "predoc-image-mgr-" + Math.random().toString(36).slice(2)
  const overlay = document.createElement("div")
  overlay.id = overlayId
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center"
  document.body.appendChild(overlay)

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close()
  }
  document.addEventListener("keydown", handleKeydown)

  const close = () => {
    document.removeEventListener("keydown", handleKeydown)
    overlay.remove()
  }

  const title = dir
    ? html`Image Manager <span style="font-weight:400;font-size:0.9rem;color:#888">— ${dir}</span>`
    : "Image Manager"

  const bodyTmpl = loadError
    ? html`<div style="padding:1rem;text-align:center;color:#bf616a">${loadError}</div>`
    : allEntries.length === 0
    ? html`<div style="padding:1rem;text-align:center;color:#888">No images in this directory</div>`
    : html`
    <style>
      .img-row {
        display: flex; align-items: stretch; gap: 12px;
        padding: 8px 0; border-bottom: 1px solid #e5e9f0;
      }
      .img-row:last-child { border-bottom: none; }
      .img-thumb {
        width: 72px; height: 72px; flex-shrink: 0;
        border-radius: 4px; overflow: hidden;
        background: #eceff4; display: flex; align-items: center; justify-content: center;
      }
      .img-thumb img { max-width: 100%; max-height: 100%; object-fit: cover; }
      .img-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
      .img-name { font-size: 0.85rem; font-weight: 600; color: #2e3440; word-break: break-all; }
      .img-used { font-size: 0.75rem; color: #888; }
      .img-used ul { margin: 2px 0 0; padding-left: 16px; list-style: disc; }
      .img-used li { line-height: 1.4; }
      .img-actions { display: flex; flex-direction: column; gap: 4px; justify-content: center; flex-shrink: 0; }
      .img-actions button {
        padding: 3px 10px; font-size: 0.75rem; border: 1px solid #d8dee9;
        border-radius: 4px; cursor: pointer; background: #fff; color: #4c566a;
        white-space: nowrap;
      }
      .img-actions button:hover { background: #e5e9f0; }
      .img-actions button.danger:hover { background: #bf616a; color: #fff; border-color: #bf616a; }
    </style>
    ${allEntries.map((entry, idx) => html`
      <div class="img-row" data-idx="${idx}">
        <div class="img-thumb">
          <img src="${entry.url}" alt="${entry.name}" @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = "none" }}>
        </div>
        <div class="img-info">
          <div class="img-name">${entry.name}${entry.pending ? html` <span style="color:#856404;font-size:0.7rem">(pending)</span>` : ""}</div>
          <div class="img-used">
            ${entry.usedIn.length > 0 ? html`
              Used in:
              <ul>
                ${entry.usedIn.map(ref => html`<li>${ref}</li>`)}
              </ul>
            ` : "Not referenced in any file"}
          </div>
        </div>
        <div class="img-actions">
          <button data-action="review" data-url="${entry.url}">Review</button>
          <button class="danger" data-action="delete" data-name="${entry.name}">Delete</button>
          <button data-action="copy" data-storage="${entry.storageUrl}">Copy</button>
        </div>
      </div>
    `)}
  `

  const tmpl = html`
    <style>
      .predoc-window { background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;flex-direction:column;max-height:80vh;min-width:520px;max-width:600px; }
      .predoc-window-header { padding:1rem 1.5rem 0;font-size:1.1rem;font-weight:600;flex-shrink:0; }
      .predoc-window-body { padding:0.5rem 1.5rem;overflow-y:auto;flex:1; }
      .predoc-window-actions { display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.5rem 1rem;flex-shrink:0; }
      .predoc-btn { padding:0.4rem 1.2rem;border-radius:4px;cursor:pointer;font-size:0.9rem;border:1px solid #d8dee9;background:#fff;color:#4c566a; }
      .predoc-btn:hover { background:#e5e9f0; }
    </style>
    <div class="predoc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <div class="predoc-window-header">${title}</div>
      <div class="predoc-window-body">${bodyTmpl}</div>
      <div class="predoc-window-actions"><button class="predoc-btn">Close</button></div>
    </div>
  `

  render(tmpl, overlay)

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close()
  })

  overlay.querySelector(".predoc-window-actions .predoc-btn")?.addEventListener("click", close)

  if (!loadError && allEntries.length > 0) {
    overlay.querySelectorAll('[data-action="review"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const url = (btn as HTMLElement).dataset.url
        if (url) window.open(url, "_blank")
      })
    })

    overlay.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const name = (btn as HTMLElement).dataset.name
        if (!name) return
        if (!confirm(`Delete "${name}"?`)) return
        try {
          await deleteImage(name)
          const row = btn.closest(".img-row") as HTMLElement
          row.remove()
          const remaining = overlay.querySelectorAll(".img-row").length
          if (remaining === 0) {
            showToast("All images deleted")
            close()
          }
          showToast(`Deleted ${name}`)
        } catch (e: any) {
          showToast(`Failed to delete: ${e.message}`)
        }
      })
    })

    overlay.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const storage = (btn as HTMLElement).dataset.storage
        if (!storage) return
        const embed = `![](${storage})`
        navigator.clipboard.writeText(embed).then(() => {
          showToast("Copied to clipboard")
        })
      })
    })
  }
}
