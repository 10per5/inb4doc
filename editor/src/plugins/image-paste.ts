import { Plugin, PluginKey } from "prosemirror-state"
import type { ResolvedPos } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import { imageService } from "@/services/image-service"

export interface ImagePasteConfig {
  uploadImage: (file: File) => Promise<string>
}

const PENDING_PREFIX = "pending-image:"

function findImageInSelection(view: EditorView): File | undefined {
  const { from, to } = view.state.selection
  let file: File | undefined
  view.state.doc.nodesBetween(from, to, (node) => {
    if (file) return false
    if (node.type.name !== "image" && node.type.name !== "image-block") return
    const src: string | undefined = node.attrs.src
    if (typeof src === "string" && src.startsWith(PENDING_PREFIX)) {
      const id = src.slice(PENDING_PREFIX.length)
      file = imageService.getImageFile(id)
    }
  })
  return file
}

function isInsideTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "tableCell" || name === "tableHeaderCell") return true
  }
  return false
}

function createImageNode(
  view: EditorView,
  url: string,
  inCell: boolean,
) {
  const schema = view.state.schema
  if (inCell) {
    const image = schema.nodes["image"]
    if (!image) return null
    return image.create({ src: url, alt: "1.00", title: "" })
  }
  const block = schema.nodes["image-block"]
  if (!block) return null
  return block.create({ src: url, caption: "", ratio: 1 })
}

export function createImagePastePlugin(config: ImagePasteConfig) {
  return new Plugin({
    key: new PluginKey("inb4doc-image-paste"),
    props: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.type.startsWith("image/")) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) return true
            const inCell = isInsideTableCell(view.state.selection.$from)
            config.uploadImage(file).then((url) => {
              const node = createImageNode(view, url, inCell)
              if (!node) return
              view.dispatch(view.state.tr.replaceSelectionWith(node))
              view.focus()
            })
            return true
          }
        }
        return false
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (file.type.startsWith("image/")) {
            event.preventDefault()
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })
            if (!pos) return true
            const inCell = isInsideTableCell(view.state.doc.resolve(pos.pos))
            config.uploadImage(file).then((url) => {
              const node = createImageNode(view, url, inCell)
              if (!node) return
              view.dispatch(view.state.tr.insert(pos.pos, node))
              view.focus()
            })
            return true
          }
        }
        return false
      },
      // Copy/cut a selection that contains an image: also place the real image
      // bytes on the clipboard (as `image/*`) so the image can be pasted into
      // another editor or external app — not just a text/markdown reference.
      // We don't preventDefault, so ProseMirror still writes the usual
      // text/html + text/plain for same-app paste. Only pending (in-session)
      // images have their bytes synchronously available here; committed images
      // fall back to the default reference copy.
      handleDOMEvents: {
        copy: (view, event) => {
          const file = findImageInSelection(view)
          if (file) {
            const item = new File([file], file.name || "image", {
              type: file.type || "image/png",
            })
            event.clipboardData?.items.add(item)
          }
          return false
        },
        cut: (view, event) => {
          const file = findImageInSelection(view)
          if (file) {
            const item = new File([file], file.name || "image", {
              type: file.type || "image/png",
            })
            event.clipboardData?.items.add(item)
          }
          return false
        },
      },
    },
  })
}
