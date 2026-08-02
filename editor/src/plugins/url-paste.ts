import { Plugin, PluginKey } from "@milkdown/kit/prose/state"

const URL_PATTERN = /^(?:https?|ftp):\/\/[^\s]+$/i

/**
 * When a URL is pasted over a selection that stays within a single block,
 * link the entire selection to the pasted URL instead of letting the
 * clipboard plugin replace it. Any link marks already inside the selection
 * are removed so the whole selection gets the new href.
 *
 * Selections spanning more than one block (or an empty selection) fall
 * through to default paste behavior, which replaces the text with the URL.
 *
 * Registered as a `$prose` plugin so it runs before `@milkdown/plugin-clipboard`
 * in the ProseMirror plugin chain (`handlePaste` is consulted in plugin order,
 * first handler returning `true` wins). Returns `false` for anything that is
 * not a URL, for an empty selection, or for cross-block selections.
 */
export function createUrlPastePlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-url-paste"),
    props: {
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData
        if (!clipboardData) return false

        const text = clipboardData.getData("text/plain").trim()
        if (!URL_PATTERN.test(text)) return false

        const { state, dispatch } = view
        const { from, to } = state.selection
        if (from === to) return false

        const linkMark = state.schema.marks.link
        if (!linkMark) return false

        const $from = state.doc.resolve(from)
        const $to = state.doc.resolve(to)
        if ($from.parent !== $to.parent) return false

        const tr = state.tr
        tr.removeMark(from, to, linkMark)
        tr.addMark(from, to, linkMark.create({ href: text }))
        dispatch(tr.setStoredMarks([]))
        return true
      },
    },
  })
}
