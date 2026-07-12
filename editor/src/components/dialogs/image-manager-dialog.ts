import { html, render } from "lit-html"
import { imageRepository } from "@/repositories/imageRepository"
import { showNotification } from "@/components/notification/notification"

export async function mountImageManagerDialog(): Promise<void> {
  const dir = imageRepository.getCurrentDocDir()

  // Fetch data first, then render once — avoids stale "Loading…" text
  let entries: Awaited<ReturnType<typeof imageRepository.listImages>> = []
  let loadError: string | null = null
  try {
    entries = await imageRepository.listImages(true)
  } catch (e: any) {
    loadError = e.message
  }

  const allEntries = imageRepository.getAllImages()

  const overlayId = "inb4doc-image-mgr-" + Math.random().toString(36).slice(2)
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
    ? html`Image Manager <span style="font-weight:400;font-size:0.9rem;color:var(--color-text-tertiary)">— ${dir}</span>`
    : "Image Manager"

  const bodyTmpl = loadError
    ? html`<div style="padding:1rem;text-align:center;color:var(--color-error)">${loadError}</div>`
    : allEntries.length === 0
    ? html`<div style="padding:1rem;text-align:center;color:var(--color-text-tertiary)">No images in this directory</div>`
    : html`
    <style>
      .img-row {
        display: flex; align-items: stretch; gap: 12px;
        padding: 8px 0; border-bottom: 1px solid var(--color-border);
      }
      .img-row:last-child { border-bottom: none; }
      .img-thumb {
        width: 72px; height: 72px; flex-shrink: 0;
        border-radius: 4px; overflow: hidden;
        background: var(--color-bg-secondary); display: flex; align-items: center; justify-content: center;
      }
      .img-thumb img { max-width: 100%; max-height: 100%; object-fit: cover; }
      .img-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
      .img-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text-primary); word-break: break-all; }
      .img-used { font-size: 0.75rem; color: var(--color-text-tertiary); }
      .img-used ul { margin: 2px 0 0; padding-left: 16px; list-style: disc; }
      .img-used li { line-height: 1.4; }
      .img-actions { display: flex; flex-direction: column; gap: 4px; justify-content: center; flex-shrink: 0; }
      .img-actions button {
        padding: 3px 10px; font-size: 0.75rem; border: 1px solid var(--color-border);
        border-radius: 4px; cursor: pointer; background: var(--color-bg-primary); color: var(--color-text-primary);
        white-space: nowrap;
      }
      .img-actions button:hover { background: var(--color-bg-tertiary); }
      .img-actions button.danger:hover { background: var(--color-error); color: #fff; border-color: var(--color-error); }
    </style>
    ${allEntries.map((entry, idx) => html`
      <div class="img-row" data-idx="${idx}">
        <div class="img-thumb">
          <img src="${entry.url}" alt="${entry.name}" @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = "none" }}>
        </div>
        <div class="img-info">
          <div class="img-name">${entry.name}${entry.pending ? html` <span style="color:var(--color-warning);font-size:0.7rem">(pending)</span>` : ""}</div>
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
      .inb4doc-window { background:var(--color-bg-primary);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;flex-direction:column;max-height:80vh;min-width:520px;max-width:600px; }
      .inb4doc-window-header { padding:1rem 1.5rem 0;font-size:1.1rem;font-weight:600;flex-shrink:0;color:var(--color-text-primary); }
      .inb4doc-window-body { padding:0.5rem 1.5rem;overflow-y:auto;flex:1;color:var(--color-text-primary); }
      .inb4doc-window-actions { display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.5rem 1rem;flex-shrink:0; }
      .inb4doc-btn { padding:0.4rem 1.2rem;border-radius:4px;cursor:pointer;font-size:0.9rem;border:1px solid var(--color-border);background:var(--color-bg-primary);color:var(--color-text-primary); }
      .inb4doc-btn:hover { background:var(--color-bg-tertiary); }
    </style>
    <div class="inb4doc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <div class="inb4doc-window-header">${title}</div>
      <div class="inb4doc-window-body">${bodyTmpl}</div>
      <div class="inb4doc-window-actions"><button class="inb4doc-btn">Close</button></div>
    </div>
  `

  render(tmpl, overlay)

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close()
  })

  overlay.querySelector(".inb4doc-window-actions .inb4doc-btn")?.addEventListener("click", close)

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
          await imageRepository.deleteImage(name)
          const row = btn.closest(".img-row") as HTMLElement
          row.remove()
          const remaining = overlay.querySelectorAll(".img-row").length
          if (remaining === 0) {
            showNotification("All images deleted", { type: "info" })
            close()
          }
          showNotification(`Deleted ${name}`, { type: "info" })
        } catch (e: any) {
          showNotification(`Failed to delete: ${e.message}`, { type: "danger" })
        }
      })
    })

    overlay.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const storage = (btn as HTMLElement).dataset.storage
        if (!storage) return
        const embed = `![](${storage})`
        navigator.clipboard.writeText(embed).then(() => {
          showNotification("Copied to clipboard", { type: "info" })
        })
      })
    })
  }
}
