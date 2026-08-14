import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { ResolvedPos } from "@milkdown/kit/prose/model"
import type { EditorView } from "@milkdown/kit/prose/view"

export interface ImagePasteConfig {
  uploadImage: (file: File) => Promise<string>
}

function isInsideTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "table_cell" || name === "table_header") return true
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
    },
  })
}
