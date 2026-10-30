/**
 * Search flash — a transient inline decoration for "this is the match".
 *
 * Replaces the old absolutely-positioned overlay div: a decoration is part of
 * the document view, so it survives scrolling, follows re-rendered content and
 * never steals clicks. The controller sets it on navigation and clears it on a
 * timer.
 */

import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"

const searchFlashKey = new PluginKey<DecorationSet>("inb4doc-search-flash")

interface FlashMeta {
  from: number
  to: number
}

export function createSearchFlashPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: searchFlashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const meta = tr.getMeta(searchFlashKey) as FlashMeta | null | undefined
        if (meta === null) return DecorationSet.empty
        if (meta) {
          const from = Math.max(0, Math.min(meta.from, tr.doc.content.size))
          const to = Math.max(from, Math.min(meta.to, tr.doc.content.size))
          if (from === to) return DecorationSet.empty
          return DecorationSet.create(tr.doc, [
            Decoration.inline(from, to, { class: "search-flash" }),
          ])
        }
        return previous.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return searchFlashKey.getState(state)
      },
    },
  })
}

/** Highlight a range until the next flash is set or cleared. */
export function flashRange(
  view: { state: any; dispatch: (tr: any) => void },
  from: number,
  to: number,
): void {
  view.dispatch(view.state.tr.setMeta(searchFlashKey, { from, to } satisfies FlashMeta))
}

/** Remove the current flash decoration. */
export function clearFlash(view: { state: any; dispatch: (tr: any) => void }): void {
  view.dispatch(view.state.tr.setMeta(searchFlashKey, null))
}
