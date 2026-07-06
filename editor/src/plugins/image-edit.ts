import { Plugin, PluginKey } from "@milkdown/kit/prose/state"

export function createImageEditPlugin() {
  return new Plugin({
    key: new PluginKey("predoc-image-edit"),
    props: {
      handleDOMEvents: {
        dblclick: (view, event) => {
          const target = event.target as HTMLElement
          const img = target.closest("img[data-type='image-block']")
          if (!img) return false
          const pos = view.posAtDOM(img, 0)
          if (pos == null) return false
          const node = view.state.doc.nodeAt(pos)
          if (!node) return false
          const src = node.attrs.src || ""
          view.dom.dispatchEvent(new CustomEvent("predoc:edit-image", {
            bubbles: true,
            detail: { pos, src },
          }))
          return true
        },
      },
    },
  })
}
