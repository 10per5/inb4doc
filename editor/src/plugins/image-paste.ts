import { Plugin, PluginKey } from "@milkdown/kit/prose/state"

export interface ImagePasteConfig {
  uploadImage: (file: File) => Promise<string>
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
            config.uploadImage(file).then((url) => {
              const node = view.state.schema.nodes["image-block"]
                ?.create({ src: url, caption: "", ratio: 1 })
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
            config.uploadImage(file).then((url) => {
              const node = view.state.schema.nodes["image-block"]
                ?.create({ src: url, caption: "", ratio: 1 })
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
