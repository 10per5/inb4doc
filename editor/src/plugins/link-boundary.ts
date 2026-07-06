import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state"

export function createLinkBoundaryPlugin() {
  return new Plugin({
    key: new PluginKey("predoc-link-boundary"),
    props: {
      handleTextInput: (view, from, to, text) => {
        if (from !== to) return false
        const { state } = view
        const $from = state.doc.resolve(from)
        const linkMark = state.schema.marks.link

        if (from <= 0) return false
        const beforeMarks = state.doc.resolve(from - 1).marks()
        if (!beforeMarks.some((m) => m.type === linkMark)) return false

        let linkAfter = false
        if (from < state.doc.content.size) {
          const afterMarks = state.doc.resolve(from + 1).marks()
          linkAfter = afterMarks.some((m) => m.type === linkMark)
        }

        if (linkAfter) return false

        const tr = state.tr
        tr.insert(from, state.schema.text(text))
        tr.setSelection(TextSelection.create(tr.doc, from + text.length))
        view.dispatch(tr)
        return true
      },
    },
  })
}
