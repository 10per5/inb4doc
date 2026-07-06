import { html, render } from "lit-html"
import type { EditorView } from "@milkdown/kit/prose/view"

export function mountHugoRefEditDialog(view: EditorView, pos: number) {
  const existing = document.getElementById("inb4doc-hugoref-overlay")
  if (existing) existing.remove()

  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== "hugoRef") return

  const overlay = document.createElement("div")
  overlay.id = "inb4doc-hugoref-overlay"
  document.body.appendChild(overlay)

  const currentPath = node.attrs.path
  const currentTitle = node.attrs.title
  const pathId = "inb4doc-hugoref-path-" + Math.random().toString(36).slice(2)
  const titleId = "inb4doc-hugoref-title-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const submit = () => {
    const pathInput = document.getElementById(pathId) as HTMLInputElement
    const titleInput = document.getElementById(titleId) as HTMLInputElement
    const newPath = pathInput?.value.trim()
    const newTitle = titleInput?.value.trim()
    close()
    if (!newPath) return

    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      path: newPath,
      title: newTitle || newPath.split("/").pop() || "",
    })
    view.dispatch(tr)
    view.focus()
  }

  const remove = () => {
    close()
    const { nodeSize } = node
    const tr = view.state.tr.delete(pos, pos + nodeSize)
    view.dispatch(tr)
    view.focus()
  }

  const tmpl = html`
    <style>
      #inb4doc-hugoref-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3);
      }
      .inb4doc-hugoref-box {
        background: var(--color-bg-primary); border-radius: 8px; padding: 1rem 1.25rem;
        min-width: 360px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2); border: 1px solid var(--color-border);
      }
      .inb4doc-hugoref-box label {
        display: block;
        font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
        color: var(--color-accent); font-weight: 700; margin-bottom: 0.4rem; margin-top: 0.6rem;
      }
      .inb4doc-hugoref-box label:first-child { margin-top: 0; }
      .inb4doc-hugoref-box input {
        width: 100%; padding: 0.4rem 0.6rem;
        border: 1px solid var(--color-border); border-radius: 4px;
        font-size: 0.9rem; box-sizing: border-box;
        background: var(--color-bg-primary); color: var(--color-text-primary);
      }
      .inb4doc-hugoref-box input:focus { outline: none; border-color: var(--color-accent); }
      .inb4doc-hugoref-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem; }
      .inb4doc-hugoref-actions button {
        padding: 0.35rem 1rem; border: 1px solid var(--color-border); border-radius: 4px;
        background: var(--color-bg-primary); cursor: pointer; font-size: 0.85rem;
        color: var(--color-text-primary);
      }
      .inb4doc-hugoref-actions button:hover { background: var(--color-bg-tertiary); }
      .inb4doc-hugoref-actions .inb4doc-hugoref-save {
        background: var(--color-accent); color: #fff; border-color: var(--color-accent);
      }
      .inb4doc-hugoref-actions .inb4doc-hugoref-save:hover { background: var(--color-accent-hover); }
      .inb4doc-hugoref-actions .inb4doc-hugoref-remove {
        color: var(--color-error); border-color: var(--color-error);
      }
      .inb4doc-hugoref-actions .inb4doc-hugoref-remove:hover { background: var(--color-bg-tertiary); }
    </style>
    <div class="inb4doc-hugoref-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <label for="${pathId}">Page Path</label>
      <input id="${pathId}" type="text" placeholder="/docs/my-page" .value=${currentPath}
        @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }}>
      <label for="${titleId}">Display Text</label>
      <input id="${titleId}" type="text" placeholder="My Page" .value=${currentTitle}
        @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }}>
      <div class="inb4doc-hugoref-actions">
        <button class="inb4doc-hugoref-remove" @click=${remove}>Remove</button>
        <button @click=${close}>Cancel</button>
        <button class="inb4doc-hugoref-save" @click=${submit}>Save</button>
      </div>
    </div>
  `

  render(tmpl, overlay)
  overlay.addEventListener("click", close)

  requestAnimationFrame(() => {
    const input = document.getElementById(pathId) as HTMLInputElement
    input?.focus()
    input?.select()
  })
}
