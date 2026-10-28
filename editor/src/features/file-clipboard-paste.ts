import { Slice } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"
import { createMarkdownBridge } from "@/config/editor-markdown"
import { clearFileClipboard, getFileClipboard } from "@/stores/file-clipboard"
import { stripFrontmatter } from "@/utils/frontmatter"

/**
 * Paste the file clipboard's contents at the caret (Ctrl/Cmd+V inside the
 * document). Frontmatter is dropped — it belongs to the page, not to the spot
 * the caret sits in, and the target document already carries its own.
 *
 * Returns false when there is nothing on the file clipboard so PM falls
 * through to the ordinary OS-clipboard paste.
 */
export function pasteFileClipboard(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const entry = getFileClipboard()
  if (!entry) return false

  const bridge = createMarkdownBridge(state.schema)
  const { body } = stripFrontmatter(entry.content)
  const parsed = bridge.parse(body || "")
  const content = parsed.content
  if (content.size === 0) return false

  if (dispatch) {
    const tr = state.tr
    const only = content.childCount === 1 ? content.firstChild : null
    if (only && only.isTextblock) {
      // Inline-first clipboard: drop the block wrapper so the text lands inside
      // whatever block the caret is already in.
      tr.replaceSelectionWith(only)
    } else {
      tr.replaceSelection(new Slice(content, 0, 0))
    }
    dispatch(tr.scrollIntoView())
  }
  clearFileClipboard()
  return true
}
