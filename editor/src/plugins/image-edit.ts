import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { EditorState } from "@milkdown/kit/prose/state"
import type { Node } from "@milkdown/kit/prose/model"
import type { EditorView } from "@milkdown/kit/prose/view"

interface ResolvedImage {
  node: Node
  pos: number
}

/**
 * Find the atomic image node at or immediately adjacent to `pos`. A plain
 * `nodeAt(pos)` misses inline atoms: `posAtDOM`/`posAtCoords` on an inline
 * atom's inner element resolves to the slot just past the node (the trailing
 * newline of the enclosing paragraph), so scan the parent textblock's children
 * straddling the position as well. Returns the atom's true start position.
 */
function resolveImageNear(state: EditorState, pos: number): ResolvedImage | null {
  const doc = state.doc
  if (pos >= 0 && pos <= doc.content.size) {
    const direct = doc.nodeAt(pos)
    if (direct && direct.isAtom) return { node: direct, pos }
  }
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  for (let d = $pos.depth; d > 0; d--) {
    const parent = $pos.node(d)
    if (!parent.isTextblock) continue
    const index = $pos.index(d)
    for (const i of [index, index - 1]) {
      if (i < 0 || i >= parent.childCount) continue
      const child = parent.child(i)
      if (child.isAtom) {
        let offset = 0
        for (let j = 0; j < i; j++) offset += parent.child(j).nodeSize
        return { node: child, pos: $pos.start(d) + offset }
      }
    }
    break
  }
  return null
}

/**
 * A screen-space point that reliably lands inside the image's box. Falls back
 * from the `<img>` (which is 0x0 until a pasted blob has decoded) to the node
 * view wrapper, which keeps its layout while the image is still loading.
 */
function anchorPointFor(
  view: EditorView,
  img: HTMLElement,
): { left: number; top: number } | null {
  const rect = img.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 }
  }
  const wrapper = img.closest(
    ".milkdown-image-block, .milkdown-image-inline",
  ) as HTMLElement | null
  const wRect = wrapper?.getBoundingClientRect()
  if (wRect && (wRect.width > 0 || wRect.height > 0)) {
    return { left: wRect.left + wRect.width / 2, top: wRect.top + wRect.height / 2 }
  }
  return null
}

export function createImageEditPlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-image-edit"),
    props: {
      handleDOMEvents: {
        dblclick: (view, event) => {
          const target = event.target as HTMLElement
          // Both block (`img[data-type="image-block"]`) and inline images
          // (`img.image-inline` inside table cells) render inside a
          // `.image-frame` that also holds the resize handles — a real browser
          // dblclick often lands on the handle (`DIV.image-resize-handle`)
          // that covers the image on hover, so match the frame, not the img.
          const img =
            (target.closest("img[data-type='image-block']") ||
              target.closest(".image-frame img")) as HTMLElement | null
          if (!img) return false
          let resolved = resolveImageNear(view.state, view.posAtDOM(img, 0) ?? -1)
          if (!resolved) {
            const anchor = anchorPointFor(view, img)
            if (anchor) {
              const coords = view.posAtCoords(anchor)
              if (coords) resolved = resolveImageNear(view.state, coords.pos)
            }
          }
          if (!resolved) return false
          view.dom.dispatchEvent(new CustomEvent("inb4doc:edit-image", {
            bubbles: true,
            detail: {
              pos: resolved.pos,
              src: resolved.node.attrs.src || "",
              attrs: { ...resolved.node.attrs },
            },
          }))
          return true
        },
      },
    },
  })
}
