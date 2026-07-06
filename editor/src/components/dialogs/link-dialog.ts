import { html, render } from "lit-html"
import type { Editor } from "@milkdown/kit/core"
import { editorViewCtx } from "@milkdown/kit/core"
import { TextSelection } from "@milkdown/kit/prose/state"
import { toggleMark } from "prosemirror-commands"

export function mountLinkDialog(getEditor: () => Editor | null) {
  const existing = document.getElementById("inb4doc-link-overlay")
  if (existing) existing.remove()

  const overlay = document.createElement("div")
  overlay.id = "inb4doc-link-overlay"
  document.body.appendChild(overlay)

  const milkdown = getEditor()
  let initialUrl = ""

  if (milkdown) {
    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      const linkMark = state.schema.marks.link
      if (linkMark) {
        const mark = state.selection.$head.marks().find((m) => m.type === linkMark)
        if (mark) {
          initialUrl = mark.attrs.href ?? ""
        }
      }
    })
  }

  const inputId = "inb4doc-link-input-" + Math.random().toString(36).slice(2)

  const close = () => overlay.remove()

  const submit = () => {
    const input = document.getElementById(inputId) as HTMLInputElement
    const url = input?.value.trim()
    close()
    const editor = getEditor()
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      const { state, dispatch } = view
      const linkMark = state.schema.marks.link
      if (url) {
        toggleMark(linkMark, { href: url })(state, (tr) => {
          const afterLink = tr.selection.to
          tr.insert(afterLink, state.schema.text(" "))
          tr.setSelection(TextSelection.create(tr.doc, afterLink + 1))
          dispatch(tr.setStoredMarks([]))
        })
      } else {
        const $head = state.selection.$head
        const existingMark = $head.marks().find((m) => m.type === linkMark)
        if (existingMark) {
          let from = $head.pos
          let to = $head.pos
          while (from > 0) {
            const resolved = state.doc.resolve(from - 1)
            if (!resolved.marks().some((m) => m.type === linkMark)) break
            from--
          }
          while (to < state.doc.content.size) {
            const resolved = state.doc.resolve(to + 1)
            if (!resolved.marks().some((m) => m.type === linkMark)) break
            to++
          }
          dispatch(state.tr.removeMark(from, to, linkMark).setStoredMarks([]))
        } else {
          dispatch(state.tr.setStoredMarks([]))
        }
      }
    })
  }

  const tmpl = html`
    <style>
      #inb4doc-link-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3);
      }
      .inb4doc-link-box {
        background: var(--color-bg-primary); border-radius: 8px; padding: 1rem 1.25rem;
        min-width: 320px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2); border: 1px solid var(--color-border);
      }
      .inb4doc-link-box label {
        display: block;
        font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
        color: var(--color-accent); font-weight: 700; margin-bottom: 0.4rem;
      }
      .inb4doc-link-box input {
        width: 100%; padding: 0.4rem 0.6rem;
        border: 1px solid var(--color-border); border-radius: 4px;
        font-size: 0.9rem; margin-bottom: 0.75rem; box-sizing: border-box;
        background: var(--color-bg-primary); color: var(--color-text-primary);
      }
      .inb4doc-link-box input:focus { outline: none; border-color: var(--color-accent); }
      .inb4doc-link-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
      .inb4doc-link-actions button {
        padding: 0.35rem 1rem; border: 1px solid var(--color-border); border-radius: 4px;
        background: var(--color-bg-primary); cursor: pointer; font-size: 0.85rem;
        color: var(--color-text-primary);
      }
      .inb4doc-link-actions button:hover { background: var(--color-bg-tertiary); }
      .inb4doc-link-actions .inb4doc-link-save {
        background: var(--color-accent); color: #fff; border-color: var(--color-accent);
      }
      .inb4doc-link-actions .inb4doc-link-save:hover { background: var(--color-accent-hover); }
    </style>
    <div class="inb4doc-link-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <label for="${inputId}">URL</label>
      <input id="${inputId}" type="text" placeholder="https://example.com" .value=${initialUrl}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") submit()
          if (e.key === "Escape") close()
        }}>
      <div class="inb4doc-link-actions">
        <button @click=${close}>Cancel</button>
        <button class="inb4doc-link-save" @click=${submit}>Save</button>
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
