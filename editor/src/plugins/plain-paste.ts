import { Plugin, PluginKey } from "prosemirror-state"
// __parseFromClipboard is exported from the prosemirror-view bundle but not
// present in its public types (it is the same helper ProseMirror's own paste
// handler uses internally).
// @ts-expect-error __parseFromClipboard is exported but untyped
import { __parseFromClipboard } from "prosemirror-view"

/**
 * Normalize plain clipboard text before it becomes editor content:
 * - `<br/>` / `<br>` / `</br>` tokens → newlines (some apps put them in
 *   text/plain literally; turning them into line breaks keeps the content).
 * - CRLF / CR → LF.
 * Skipped inside code blocks, where literal text must stay byte-for-byte.
 */
function normalizePlainText(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n").replace(/\r\n?/g, "\n")
}

/**
 * Ctrl/Cmd+Shift+V → paste as plain text.
 *
 * ProseMirror implements this natively: its paste handler reads
 * `view.input.shiftKey && view.input.lastKeyCode != 45` and rebuilds the
 * paste with `plainText=true`. That path never runs here because
 * The clipboard plugin's `handlePaste` intercepts every paste first
 * and re-interprets plain text as Markdown.
 *
 * This plugin is prepended to the plugin chain (before the Milkdown clipboard
 * plugin), so its `handlePaste` is consulted first. For the shift-paste
 * gesture only it rebuilds the pasted text through `__parseFromClipboard`
 * with `plainText=true`: literal text, line breaks as paragraphs (or raw text
 * inside code blocks), no HTML, no Markdown interpretation. Every other paste
 * gesture returns false and falls through to the existing pipeline unchanged.
 */
export function createPlainPastePlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-plain-paste"),
    props: {
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData
        if (!clipboardData) return false

        // Same signal ProseMirror's own paste handler uses (and deliberately
        // excludes Shift+Insert, keycode 45).
        const input = (
          view as unknown as {
            input?: { shiftKey: boolean; lastKeyCode: number | null }
          }
        ).input
        if (!input) return false
        if (!(input.shiftKey && input.lastKeyCode !== 45)) return false

        const text =
          clipboardData.getData("text/plain") || clipboardData.getData("Text")
        if (!text) return false
        const inCode = !!view.state.selection.$from.parent.type.spec.code
        const plain = inCode ? text : normalizePlainText(text)

        const slice = __parseFromClipboard(
          view,
          plain,
          "",
          true,
          view.state.selection.$from,
        )
        if (!slice) return false

        view.dispatch(
          view.state.tr
            .replaceSelection(slice)
            .scrollIntoView()
            .setMeta("paste", true),
        )
        return true
      },
    },
  })
}
