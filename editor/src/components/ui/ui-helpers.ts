import { html } from "lit-html"

export type ButtonVariant = "primary" | "danger" | "default"

export const overlayStyles = `
#predoc-dialog-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 1000; display: flex; align-items: center; justify-content: center;
}
`

export const windowStyles = `
.predoc-window {
  background: var(--color-bg-primary); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  display: flex; flex-direction: column; max-height: 80vh;
  min-width: 420px; max-width: 560px;
}
.predoc-window-header {
  padding: 1rem 1.5rem 0; font-size: 1.1rem; font-weight: 600; flex-shrink: 0;
  color: var(--color-text-primary);
}
.predoc-window-body {
  padding: 0.5rem 1.5rem; overflow-y: auto; flex: 1;
  color: var(--color-text-primary);
}
.predoc-window-actions {
  display: flex; gap: 0.5rem; justify-content: flex-end;
  padding: 0.75rem 1.5rem 1rem; flex-shrink: 0;
}
`

export const buttonStyles = `
.predoc-btn {
  padding: 0.4rem 1.2rem; border-radius: 4px; cursor: pointer;
  font-size: 0.9rem; border: 1px solid var(--color-border); background: var(--color-bg-primary);
  color: var(--color-text-primary); transition: background 0.15s, border-color 0.15s;
}
.predoc-btn:hover { background: var(--color-bg-tertiary); }
.predoc-btn.predoc-btn-primary {
  background: var(--color-accent); color: #fff; border-color: var(--color-accent);
}
.predoc-btn.predoc-btn-primary:hover { background: var(--color-accent-hover); }
.predoc-btn.predoc-btn-danger {
  background: var(--color-error); color: #fff; border-color: var(--color-error);
}
.predoc-btn.predoc-btn-danger:hover { background: #a9444e; }
`

export function miniWindow(title: string, body: unknown, actions: unknown) {
  return html`
    <style>${overlayStyles}${windowStyles}${buttonStyles}</style>
    <div class="predoc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <div class="predoc-window-header">${title}</div>
      <div class="predoc-window-body">${body}</div>
      <div class="predoc-window-actions">${actions}</div>
    </div>
  `
}

export interface ButtonOpts {
  label: string
  variant?: ButtonVariant
  disabled?: boolean
}

export function actionBtn(opts: ButtonOpts) {
  const cls = ["predoc-btn"]
  if (opts.variant === "primary") cls.push("predoc-btn-primary")
  if (opts.variant === "danger") cls.push("predoc-btn-danger")
  return html`<button class=${cls.join(" ")} ?disabled=${opts.disabled ?? false}>${opts.label}</button>`
}
