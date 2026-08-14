import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state"
import { Fragment, Slice, type Node, type NodeType, type ResolvedPos } from "@milkdown/kit/prose/model"
import type { EditorView } from "@milkdown/kit/prose/view"
import { encodeAlt } from "@/plugins/image-resize"

export interface ImageTableDropConfig {
  uploadImage?: (file: File) => Promise<string>
}

function isInsideTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "table_cell" || name === "table_header") return true
  }
  return false
}

/**
 * Depth of the `table_cell`/`table_header` ancestor of `$pos`, or -1 when the
 * position is not inside a cell.
 */
function cellDepthAt($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "table_cell" || name === "table_header") return d
  }
  return -1
}

/**
 * Position inside the first paragraph of the cell that contains `$pos`.
 * `posAtCoords` over a table tends to resolve to the cell boundary rather than
 * the cell's paragraph; inserting at `start(depth) + 1` anchors the image
 * inside the cell instead of fitting it at the table level (which would create
 * a phantom column).
 */
function cellInsertPos($pos: ResolvedPos): number | null {
  const cellDepth = cellDepthAt($pos)
  if (cellDepth < 0) return null
  return $pos.start(cellDepth) + 1
}

/**
 * Find the `td`/`th` element on the drop event's target path and resolve it to
 * a position inside that cell. More reliable than `posAtCoords` for tables,
 * which frequently resolves to the wrong cell or the cell boundary.
 */
function cellPosFromEvent(view: EditorView, event: DragEvent): number | null {
  let el = (event.target as Element | null)
  while (el && el !== view.dom) {
    if (el.tagName === "TD" || el.tagName === "TH") {
      const pos = view.posAtDOM(el, 0)
      if (pos != null) {
        const insert = cellInsertPos(view.state.doc.resolve(pos))
        if (insert != null) return insert
      }
      return null
    }
    el = el.parentElement
  }
  return null
}

/**
 * Convert every `image-block` in a fragment into an inline `image`, recursing
 * into block children so pasted/dropped content that wraps the image-block
 * (e.g. a paragraph) still ends up with valid inline content. Returns the
 * original fragment unchanged if there is nothing to convert.
 */
function convertImageBlocksToInline(
  fragment: Fragment,
  imageBlockType: NodeType,
  imageType: NodeType,
): { fragment: Fragment; changed: boolean } {
  const nodes: Node[] = []
  let changed = false
  fragment.forEach((node) => {
    if (node.type === imageBlockType) {
      changed = true
      const a = node.attrs
      nodes.push(
        imageType.create({
          src: a.src ?? "",
          alt: encodeAlt(a.ratio, a.w, a.h),
          title: a.caption ?? "",
        }),
      )
    } else if (node.isBlock && node.content.size > 0) {
      const nested = convertImageBlocksToInline(
        node.content,
        imageBlockType,
        imageType,
      )
      nodes.push(
        nested.changed
          ? node.copy(nested.fragment)
          : node,
      )
      changed = changed || nested.changed
    } else {
      nodes.push(node)
    }
  })
  if (!changed) return { fragment, changed: false }
  return { fragment: Fragment.from(nodes), changed: true }
}

/**
 * Handle a drop whose target is inside a table cell. ProseMirror never sees
 * drag/drop events over tables: the `tableBlock` node view's `stopEvent`
 * returns true for them, which makes `eventBelongsToView` reject the event
 * before any `handleDrop` prop (or the drop cursor) runs. So this listener is
 * bound directly on the editor view's DOM, where it runs after PM's own
 * (silently skipped) listener.
 */
function handleCellDrop(view: EditorView, event: DragEvent, config: ImageTableDropConfig) {
  if (!view.editable) return
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return

  const schema = view.state.schema
  const imageBlockType = schema.nodes["image-block"]
  const imageType = schema.nodes["image"]
  if (!imageBlockType || !imageType) return

  const insertPos = cellPosFromEvent(view, event)
  if (insertPos == null) return

  // In-editor drag of an image-block: convert the slice to inline images.
  const dragging = (view as any).dragging
  const slice = dragging?.slice
  if (slice && slice.content.size > 0) {
    const converted = convertImageBlocksToInline(
      slice.content,
      imageBlockType,
      imageType,
    )
    if (converted.changed) {
      event.preventDefault()
      event.stopPropagation()
      const inlineSlice = new Slice(converted.fragment, 0, 0)
      const tr = view.state.tr
      if (dragging.move) {
        if (dragging.node) dragging.node.replace(tr)
        else tr.deleteSelection()
      }
      const pos = tr.mapping.map(insertPos)
      tr.replaceRange(pos, pos, inlineSlice)
      const $pos = tr.doc.resolve(pos)
      tr.setSelection(TextSelection.near($pos))
      view.dispatch(tr.setMeta("uiEvent", "drop"))
      view.focus()
      return
    }
  }

  // OS file drop of an image into a cell.
  const files = dataTransfer.files
  if (files.length && config.uploadImage) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        event.preventDefault()
        event.stopPropagation()
        config.uploadImage(file).then((url) => {
          const node = imageType.create({ src: url, alt: "1.00", title: "" })
          const tr = view.state.tr
          const pos = tr.mapping.map(insertPos)
          tr.replaceRange(pos, pos, new Slice(Fragment.from(node), 0, 0))
          view.dispatch(tr)
          view.focus()
        })
        break
      }
    }
  }
}

export function createImageTableDropPlugin(config: ImageTableDropConfig = {}) {
  return new Plugin({
    key: new PluginKey("inb4doc-image-table-drop"),
    view: (view) => {
      const onDrop = (event: DragEvent) => handleCellDrop(view, event, config)
      view.dom.addEventListener("drop", onDrop)
      return {
        update: () => {},
        destroy: () => {
          view.dom.removeEventListener("drop", onDrop)
        },
      }
    },
    props: {
      handlePaste: (view, event, slice) => {
        if (!event.clipboardData) return false
        if (!isInsideTableCell(view.state.selection.$from)) return false

        const schema = view.state.schema
        const imageBlockType = schema.nodes["image-block"]
        const imageType = schema.nodes["image"]
        if (!imageBlockType || !imageType) return false
        if (!slice || slice.content.size === 0) return false

        const converted = convertImageBlocksToInline(
          slice.content,
          imageBlockType,
          imageType,
        )
        if (!converted.changed) return false

        event.preventDefault()
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(converted.fragment, 0, 0))
            .setMeta("paste", true),
        )
        view.focus()
        return true
      },
    },
  })
}
