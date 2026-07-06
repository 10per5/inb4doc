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
  const existing = document.getElementById("inb4doc-dialog-overlay")
  if (existing) existing.remove()
  const overlay = document.createElement("div")
  overlay.id = "inb4doc-dialog-overlay"
  document.body.appendChild(overlay)
  return overlay
}

const dialogStyles = `
  #inb4doc-dialog-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    z-index: 1000; display: flex; align-items: center; justify-content: center;
  }
  .inb4doc-dialog-box {
    background: var(--color-bg-primary); border-radius: 8px; padding: 1.5rem;
    min-width: 360px; max-width: 480px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }
  .inb4doc-dialog-box h3 { margin: 0 0 0.5rem; font-size: 1.1rem; color: var(--color-text-primary); }
  .inb4doc-dialog-box p { margin: 0 0 1rem; color: var(--color-text-secondary); font-size: 0.9rem; }
  .inb4doc-dialog-box label { display: block; margin-bottom: 0.3rem; font-size: 0.85rem; color: var(--color-accent); font-weight: 600; }
  .inb4doc-dialog-box input {
    width: 100%; padding: 0.4rem 0.6rem; border: 1px solid var(--color-border); border-radius: 4px;
    font-size: 0.9rem; margin-bottom: 1rem; box-sizing: border-box;
    background: var(--color-bg-primary); color: var(--color-text-primary);
  }
  .inb4doc-dialog-box input:focus { outline: none; border-color: var(--color-accent); }
  .inb4doc-dialog-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .inb4doc-dialog-actions button {
    padding: 0.4rem 1.2rem; border: 1px solid var(--color-border); border-radius: 4px;
    background: var(--color-bg-primary); cursor: pointer; font-size: 0.9rem;
    color: var(--color-text-primary);
  }
  .inb4doc-dialog-actions button:hover { background: var(--color-bg-tertiary); }
  .inb4doc-dialog-actions .inb4doc-dialog-confirm { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
  .inb4doc-dialog-actions .inb4doc-dialog-confirm:hover { background: var(--color-accent-hover); }
`

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const overlay = createOverlay()

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}</style>
    <div class="inb4doc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${opts.title}</h3>
      <p>${opts.message}</p>
      <div class="inb4doc-dialog-actions">
        <button class="inb4doc-dialog-cancel">${opts.cancelLabel ?? "Cancel"}</button>
        <button class="inb4doc-dialog-confirm ${opts.confirmClass ?? ""}">${opts.confirmLabel ?? "Confirm"}</button>
      </div>
    </div>
  `

  render(tmpl, overlay)

  return new Promise<boolean>((resolve) => {
    const cleanup = (result: boolean) => {
      close()
      resolve(result)
    }

    overlay.querySelector(".inb4doc-dialog-cancel")!.addEventListener("click", () => cleanup(false))
    overlay.querySelector(".inb4doc-dialog-confirm")!.addEventListener("click", () => cleanup(true))
    overlay.addEventListener("click", () => cleanup(false))
  })
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  const overlay = createOverlay()
  const inputId = "inb4doc-prompt-input-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}</style>
    <div class="inb4doc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${opts.title}</h3>
      ${opts.label ? html`<label for="${inputId}">${opts.label}</label>` : ""}
      <input id="${inputId}" type="text" placeholder="${opts.placeholder ?? ""}" value="${opts.value ?? ""}" @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.target as HTMLElement).closest(".inb4doc-dialog-box")?.querySelector<HTMLElement>(".inb4doc-dialog-confirm")?.click()
        if (e.key === "Escape") close()
      }}>
      <div class="inb4doc-dialog-actions">
        <button class="inb4doc-dialog-cancel">${opts.cancelLabel ?? "Cancel"}</button>
        <button class="inb4doc-dialog-confirm">${opts.confirmLabel ?? "Create"}</button>
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

    overlay.querySelector(".inb4doc-dialog-cancel")!.addEventListener("click", () => cleanup(null))
    overlay.querySelector(".inb4doc-dialog-confirm")!.addEventListener("click", () => cleanup(input?.value ?? null))
    overlay.addEventListener("click", () => cleanup(null))
  })
}

export function promptCreateDialog(title: string): Promise<CreateDialogResult | null> {
  const overlay = createOverlay()
  const inputId = "inb4doc-create-input-" + Math.random().toString(36).slice(2)
  const checkId = "inb4doc-create-check-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const tmpl = html`
    <style>${dialogStyles}
      .inb4doc-dialog-check { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 1rem; }
      .inb4doc-dialog-check input { width: auto; margin: 0; }
      .inb4doc-dialog-check label { margin: 0; cursor: pointer; }
    </style>
    <div class="inb4doc-dialog-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>${title}</h3>
      <label for="${inputId}">Name</label>
      <input id="${inputId}" type="text" placeholder="My Page" @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.target as HTMLElement).closest(".inb4doc-dialog-box")?.querySelector<HTMLElement>(".inb4doc-dialog-confirm")?.click()
        if (e.key === "Escape") close()
      }}>
      <div class="inb4doc-dialog-check">
        <input id="${checkId}" type="checkbox">
        <label for="${checkId}">Create directory</label>
      </div>
      <div class="inb4doc-dialog-actions">
        <button class="inb4doc-dialog-cancel">Cancel</button>
        <button class="inb4doc-dialog-confirm">Create</button>
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

    overlay.querySelector(".inb4doc-dialog-cancel")!.addEventListener("click", () => cleanup(null))
    overlay.querySelector(".inb4doc-dialog-confirm")!.addEventListener("click", () => {
      const name = input?.value?.trim()
      if (!name) return
      cleanup({ name, asDirectory: checkbox?.checked ?? false })
    })
    overlay.addEventListener("click", () => cleanup(null))
  })
}
