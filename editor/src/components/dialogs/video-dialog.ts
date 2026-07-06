import { html, render } from "lit-html"

export interface VideoDialogResult {
  src: string
  width: string
  height: string
  controls: boolean
  loop: boolean
  muted: boolean
  autoplay: boolean
}

export function mountVideoDialog(
  current: VideoDialogResult,
  onSave: (result: VideoDialogResult) => void,
  onRemove: () => void,
) {
  const existing = document.getElementById("predoc-video-overlay")
  if (existing) existing.remove()

  const overlay = document.createElement("div")
  overlay.id = "predoc-video-overlay"
  document.body.appendChild(overlay)

  const inputId = "predoc-video-input-" + Math.random().toString(36).slice(2)
  const widthId = "predoc-video-width-" + Math.random().toString(36).slice(2)
  const heightId = "predoc-video-height-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const submit = () => {
    const input = document.getElementById(inputId) as HTMLInputElement
    const widthInput = document.getElementById(widthId) as HTMLInputElement
    const heightInput = document.getElementById(heightId) as HTMLInputElement
    const controlsCb = overlay.querySelector("#video-controls") as HTMLInputElement
    const loopCb = overlay.querySelector("#video-loop") as HTMLInputElement
    const mutedCb = overlay.querySelector("#video-muted") as HTMLInputElement
    const autoplayCb = overlay.querySelector("#video-autoplay") as HTMLInputElement

    const result: VideoDialogResult = {
      src: input?.value.trim() || "",
      width: widthInput?.value.trim() || "",
      height: heightInput?.value.trim() || "",
      controls: controlsCb?.checked ?? true,
      loop: loopCb?.checked ?? false,
      muted: mutedCb?.checked ?? false,
      autoplay: autoplayCb?.checked ?? false,
    }

    close()
    onSave(result)
  }

  const tmpl = html`
    <style>
      #predoc-video-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3);
      }
      .predoc-video-box {
        background: var(--color-bg-primary); border-radius: 8px; padding: 1rem 1.25rem;
        min-width: 380px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2); border: 1px solid var(--color-border);
      }
      .predoc-video-box h3 { margin: 0 0 0.75rem; font-size: 1rem; color: var(--color-text-primary); }
      .predoc-video-box label.row {
        display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;
        font-size: 0.85rem; color: var(--color-text-primary);
      }
      .predoc-video-box label.row input[type="checkbox"] { margin: 0; }
      .predoc-video-box label.block {
        display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
        color: var(--color-accent); font-weight: 700; margin-bottom: 0.25rem; margin-top: 0.5rem;
      }
      .predoc-video-box label.block:first-of-type { margin-top: 0; }
      .predoc-video-box input[type="text"],
      .predoc-video-box input[type="number"] {
        width: 100%; padding: 0.4rem 0.6rem;
        border: 1px solid var(--color-border); border-radius: 4px;
        font-size: 0.9rem; margin-bottom: 0.5rem; box-sizing: border-box;
        background: var(--color-bg-primary); color: var(--color-text-primary);
      }
      .predoc-video-box input:focus { outline: none; border-color: var(--color-accent); }
      .predoc-video-dimensions { display: flex; gap: 0.75rem; }
      .predoc-video-dimensions > div { flex: 1; }
      .predoc-video-checkboxes { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-bottom: 0.75rem; }
      .predoc-video-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
      .predoc-video-actions button {
        padding: 0.35rem 1rem; border: 1px solid var(--color-border); border-radius: 4px;
        background: var(--color-bg-primary); cursor: pointer; font-size: 0.85rem;
        color: var(--color-text-primary);
      }
      .predoc-video-actions button:hover { background: var(--color-bg-tertiary); }
      .predoc-video-actions .video-save {
        background: var(--color-accent); color: #fff; border-color: var(--color-accent);
      }
      .predoc-video-actions .video-save:hover { background: var(--color-accent-hover); }
      .predoc-video-actions .video-remove {
        color: var(--color-error); border-color: var(--color-error);
      }
      .predoc-video-actions .video-remove:hover { background: var(--color-bg-tertiary); }
    </style>
    <div class="predoc-video-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>Edit Video</h3>

      <label class="block" for="${inputId}">Video URL</label>
      <input id="${inputId}" type="text" placeholder="https://example.com/video.mp4" .value=${current.src}
        @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }}>

      <div class="predoc-video-dimensions">
        <div>
          <label class="block" for="${widthId}">Width</label>
          <input id="${widthId}" type="text" placeholder="auto" .value=${current.width}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") submit(); }}>
        </div>
        <div>
          <label class="block" for="${heightId}">Height</label>
          <input id="${heightId}" type="text" placeholder="auto" .value=${current.height}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") submit(); }}>
        </div>
      </div>

      <div class="predoc-video-checkboxes">
        <label class="row">
          <input id="video-controls" type="checkbox" ?checked=${current.controls}>
          Controls
        </label>
        <label class="row">
          <input id="video-loop" type="checkbox" ?checked=${current.loop}>
          Loop
        </label>
        <label class="row">
          <input id="video-muted" type="checkbox" ?checked=${current.muted}>
          Muted
        </label>
        <label class="row">
          <input id="video-autoplay" type="checkbox" ?checked=${current.autoplay}>
          Autoplay
        </label>
      </div>

      <div class="predoc-video-actions">
        <button class="video-remove" @click=${() => { close(); onRemove(); }}>Remove</button>
        <button @click=${close}>Cancel</button>
        <button class="video-save" @click=${submit}>Save</button>
      </div>
    </div>
  `

  render(tmpl, overlay)
  overlay.addEventListener("click", close)

  requestAnimationFrame(() => {
    const input = document.getElementById(inputId) as HTMLInputElement
    input?.focus()
    input?.select()
  })
}
