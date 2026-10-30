/**
 * Title placeholder for pages created without a name.
 *
 * File ▸ New / "+ New" create the page under a throwaway slug with a bare
 * `# heading` as the first line; whatever is typed there renames the file (see
 * features/auto-name). Until then the heading is empty, which looks like a
 * broken page. This decoration adds a gray prompt instead.
 *
 * It is a ProseMirror node decoration, never document content: it cannot be
 * serialized, and it disappears on the first transaction that puts text in the
 * heading. Only auto-named pages get it, so ordinary documents with an empty
 * heading are untouched.
 */

import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import { isAutoNamed } from "@/features/auto-name"

export const AUTO_TITLE_PLACEHOLDER = "Name this page…"

export function createAutoTitlePlaceholderPlugin(
  getCurrentPath: () => string,
): Plugin {
  return new Plugin({
    key: new PluginKey("auto-title-placeholder"),
    props: {
      decorations(state) {
        if (!isAutoNamed(getCurrentPath())) return null
        const first = state.doc.firstChild
        if (!first || first.type.name !== "heading" || first.content.size > 0) {
          return null
        }
        return DecorationSet.create(state.doc, [
          Decoration.node(0, first.nodeSize, {
            class: "auto-title-empty",
            "data-placeholder": AUTO_TITLE_PLACEHOLDER,
          }),
        ])
      },
    },
  })
}
