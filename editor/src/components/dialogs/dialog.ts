import { html, render } from "lit-html"

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmClass?: string
}

export interface PromptOptions {
  title: string
  label?: string
  placeholder?: string
  value?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface CreateDialogResult {
  name: string
  asDirectory: boolean
}

function createOverlay(): HTMLDivElement {
  const existing = document.getElementById("predoc-dialog-overlay")
  if (existing) existing.remove()
  const overlay = document.createElement("div")
  overlay.id = "predoc-dialog-overlay"
  document.body.appendChild(overlay)
  return overlay
}

const dialogStyles = `
  #predoc-dialog-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    z-index: 1000; display: flex; align-items: center; justify-content: center;
  }
  .predoc-dialog-box {
    background: #fff; border-radius: 8px; padding: 1.5rem;
    min-width: 360px; max-width: 480px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }
  .predoc-dialog-box h3 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .predoc-dialog-box p { margin: 0 0 1rem; color: #666; font-size: 0.9rem; }
  .predoc-dialog-box label { display: block; margin-bottom: 0.3rem; font-size: 0.85rem; color: #5e81ac; font-weight: 600; }
  .predoc-dialog-box input {
    width: 100%; padding: 0.4rem 0.6rem; border: 1px solid #d8dee9; border-radius: 4px;
    font-size: 0.9rem; margin-bottom: 1rem; box-sizing: border-box;
  }
  .predoc-dialog-box input:focus { outline: none; border-color: #5e81ac; }
  .predoc-dialog-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .predoc-dialog-actions button {
    padding: 0.4rem 1.2rem; border: 1px solid #d8dee9; border-radius: 4px;
    background: #fff; cursor: pointer; font-size: 0.9rem;
  }
  .predoc-dialog-actions button:hover { background: #e5e9f0; }
  .predoc-dialog-actions .predoc-dialog-confirm { background: #5e81ac; color: #fff; border-color: #5e81ac; }
  .predoc-dialog-actions .predoc-dialog-confirm:hover { background: #4a7098; }
`

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const overlay = createOverlay()

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}</style>
    <div class="predoc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${opts.title}</h3>
      <p>${opts.message}</p>
      <div class="predoc-dialog-actions">
        <button class="predoc-dialog-cancel">${opts.cancelLabel ?? "Cancel"}</button>
        <button class="predoc-dialog-confirm ${opts.confirmClass ?? ""}">${opts.confirmLabel ?? "Confirm"}</button>
      </div>
    </div>
  `

  render(tmpl, overlay)

  return new Promise<boolean>((resolve) => {
    const cleanup = (result: boolean) => {
      close()
      resolve(result)
    }

    overlay.querySelector(".predoc-dialog-cancel")!.addEventListener("click", () => cleanup(false))
    overlay.querySelector(".predoc-dialog-confirm")!.addEventListener("click", () => cleanup(true))
    overlay.addEventListener("click", () => cleanup(false))
  })
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  const overlay = createOverlay()
  const inputId = "predoc-prompt-input-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}</style>
    <div class="predoc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${opts.title}</h3>
      ${opts.label ? html`<label for="${inputId}">${opts.label}</label>` : ""}
      <input id="${inputId}" type="text" placeholder="${opts.placeholder ?? ""}" value="${opts.value ?? ""}" @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.target as HTMLElement).closest(".predoc-dialog-box")?.querySelector<HTMLElement>(".predoc-dialog-confirm")?.click()
        if (e.key === "Escape") close()
      }}>
      <div class="predoc-dialog-actions">
        <button class="predoc-dialog-cancel">${opts.cancelLabel ?? "Cancel"}</button>
        <button class="predoc-dialog-confirm">${opts.confirmLabel ?? "Create"}</button>
      </div>
    </div>
  `

  render(tmpl, overlay)

  return new Promise<string | null>((resolve) => {
    const input = document.getElementById(inputId) as HTMLInputElement
    input?.focus()
    input?.select()

    const cleanup = (result: string | null) => {
      close()
      resolve(result)
    }

    overlay.querySelector(".predoc-dialog-cancel")!.addEventListener("click", () => cleanup(null))
    overlay.querySelector(".predoc-dialog-confirm")!.addEventListener("click", () => cleanup(input?.value ?? null))
    overlay.addEventListener("click", () => cleanup(null))
  })
}

export function promptCreateDialog(title: string): Promise<CreateDialogResult | null> {
  const overlay = createOverlay()
  const inputId = "predoc-create-input-" + Math.random().toString(36).slice(2)
  const checkId = "predoc-create-check-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}
      .predoc-dialog-check { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 1rem; }
      .predoc-dialog-check input { width: auto; margin: 0; }
      .predoc-dialog-check label { margin: 0; cursor: pointer; }
    </style>
    <div class="predoc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${title}</h3>
      <label for="${inputId}">Name</label>
      <input id="${inputId}" type="text" placeholder="My Page" @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.target as HTMLElement).closest(".predoc-dialog-box")?.querySelector<HTMLElement>(".predoc-dialog-confirm")?.click()
        if (e.key === "Escape") close()
      }}>
      <div class="predoc-dialog-check">
        <input id="${checkId}" type="checkbox">
        <label for="${checkId}">Create directory</label>
      </div>
      <div class="predoc-dialog-actions">
        <button class="predoc-dialog-cancel">Cancel</button>
        <button class="predoc-dialog-confirm">Create</button>
      </div>
    </div>
  `

  render(tmpl, overlay)

  return new Promise<CreateDialogResult | null>((resolve) => {
    const input = document.getElementById(inputId) as HTMLInputElement
    const checkbox = document.getElementById(checkId) as HTMLInputElement
    input?.focus()
    input?.select()

    const cleanup = (result: CreateDialogResult | null) => {
      close()
      resolve(result)
    }

    overlay.querySelector(".predoc-dialog-cancel")!.addEventListener("click", () => cleanup(null))
    overlay.querySelector(".predoc-dialog-confirm")!.addEventListener("click", () => {
      const name = input?.value?.trim()
      if (!name) return
      cleanup({ name, asDirectory: checkbox?.checked ?? false })
    })
    overlay.addEventListener("click", () => cleanup(null))
  })
}
