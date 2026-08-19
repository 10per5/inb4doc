import { NodeSelection, Plugin, PluginKey, TextSelection } from "prosemirror-state"
import { Fragment, Slice, type Node, type NodeType, type ResolvedPos } from "prosemirror-model"
import { dropPoint } from "prosemirror-transform"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import { encodeAlt } from "@/plugins/image-resize"

export interface EditorDragDropConfig {
  uploadImage?: (file: File) => Promise<string>
}

/** Drop indicator styling is handled by CSS (.inb4doc-drop-cursor in dnd.css). */
export function configureDropIndicator(): void {}

interface DropTarget {
  from: number
  to: number
  rejected: boolean
}

const dropTargetKey = new PluginKey<DropTarget | null>(
  "inb4doc-editor-drag-drop-target",
)

export function isInsideTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "tableCell" || name === "tableHeaderCell") return true
  }
  return false
}

function cellDepthAt($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "tableCell" || name === "tableHeaderCell") return d
  }
  return -1
}

function cellInsertPos($pos: ResolvedPos): number | null {
  const cellDepth = cellDepthAt($pos)
  if (cellDepth < 0) return null
  return $pos.start(cellDepth) + 1
}

function tableCellAtPoint(
  view: EditorView,
  x: number,
  y: number,
  ignore?: Element | null,
): Element | null {
  const el = view.dom.ownerDocument.elementFromPoint(x, y) as Element | null
  if (el && ignore && (el === ignore || ignore.contains(el))) return null
  let node = el
  while (node && node !== view.dom) {
    if (node.tagName === "TD" || node.tagName === "TH") {
      return view.dom.contains(node) ? node : null
    }
    node = node.parentElement
  }
  const nearest = nearestCellInBlock(view.dom, x, y)
  if (!nearest) return null
  const r = nearest.getBoundingClientRect()
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
  return Math.hypot(dx, dy) <= 24 ? nearest : null
}

function nearestCellInBlock(
  block: Element,
  x: number,
  y: number,
): Element | null {
  let nearest: Element | null = null
  let nearestDist = Infinity
  for (const cell of Array.from(block.querySelectorAll("td, th"))) {
    const r = cell.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
      return cell
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    const dist = Math.hypot(dx, dy)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = cell
    }
  }
  return nearest
}

function cellPosFromEvent(view: EditorView, event: DragEvent): number | null {
  const cell = tableCellAtPoint(view, event.clientX, event.clientY)
  if (!cell) return null
  const pos = view.posAtDOM(cell, 0)
  if (pos == null) return null
  return cellInsertPos(view.state.doc.resolve(pos))
}

function cellNodeRange(
  view: EditorView,
  cell: Element,
): { from: number; to: number } | null {
  const pos = view.posAtDOM(cell, 0)
  if (pos == null) return null
  const $pos = view.state.doc.resolve(pos)
  const depth = cellDepthAt($pos)
  if (depth < 0) return null
  const node = $pos.node(depth)
  return { from: $pos.before(depth), to: $pos.before(depth) + node.nodeSize }
}

function caretRangeAtPoint(doc: Document, x: number, y: number): Range | null {
  if (typeof doc.caretRangeFromPoint === "function") {
    return doc.caretRangeFromPoint(x, y)
  }
  const position = doc.caretPositionFromPoint(x, y)
  if (position && position.offsetNode) {
    const range = doc.createRange()
    range.setStart(position.offsetNode, position.offset)
    return range
  }
  return null
}

function resolveTextDrop(
  view: EditorView,
  drag: { from: number; to: number; slice: Slice },
  x: number,
  y: number,
): void {
  const cell = tableCellAtPoint(view, x, y)
  let targetPos: number | null = null
  if (cell) {
    const pos = view.posAtDOM(cell, 0)
    if (pos != null) targetPos = cellInsertPos(view.state.doc.resolve(pos))
  } else {
    const coords = view.posAtCoords({ left: x, top: y })
    if (!coords) return
    const $pos = view.state.doc.resolve(coords.pos)
    const cellDepth = cellDepthAt($pos)
    if (cellDepth >= 0) {
      targetPos = $pos.start(cellDepth) + 1
    } else {
      targetPos = dropPoint(view.state.doc, coords.pos, drag.slice) ?? coords.pos
    }
  }
  if (targetPos == null) return
  if (targetPos >= drag.from && targetPos <= drag.to) return
  const tr = view.state.tr
  tr.delete(drag.from, drag.to)
  const insertPos = tr.mapping.map(targetPos)
  tr.replaceRange(insertPos, insertPos, drag.slice)
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos)))
  view.dispatch(tr.setMeta("uiEvent", "drop"))
  view.focus()
}

function flattenToInline(
  fragment: Fragment,
  imageBlockType: NodeType,
  imageType: NodeType,
): Fragment | null {
  const out: Node[] = []
  let ok = true
  fragment.forEach((node) => {
    if (!ok) return
    if (node.isInline) {
      out.push(node)
      return
    }
    const hardBreak = node.type.schema.nodes["hardBreak"]
    const separator = () => {
      if (hardBreak && out.length > 0) out.push(hardBreak.create())
    }
    if (node.type === imageBlockType) {
      separator()
      const a = node.attrs
      out.push(
        imageType.create({
          src: a.src ?? "",
          alt: encodeAlt(a.ratio, a.w, a.h),
          title: a.caption ?? "",
        }),
      )
      return
    }
    const name = node.type.name
    const isTextContainer =
      node.isTextblock ||
      name === "list" ||
      name === "blockquote" ||
      name === "alert"
    if (!isTextContainer) {
      ok = false
      return
    }
    const inner = flattenToInline(node.content, imageBlockType, imageType)
    if (!inner) {
      ok = false
      return
    }
    if (inner.size > 0) {
      separator()
      inner.forEach((n) => out.push(n))
    }
  })
  if (!ok) return null
  return Fragment.from(out)
}

function isDropOverTable(view: EditorView, event: DragEvent): boolean {
  const target = event.target
  if (target instanceof Element && target.closest(".ProseMirror-table-node")) {
    return true
  }
  if (tableCellAtPoint(view, event.clientX, event.clientY)) return true
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!coords) return false
  const $pos = view.state.doc.resolve(coords.pos)
  return (
    cellDepthAt($pos) >= 0 ||
    $pos.parent.type.name === "table" ||
    $pos.parent.type.name === "tableRow"
  )
}

function handleCellDrop(view: EditorView, event: DragEvent, config: EditorDragDropConfig) {
  if (!view.editable) return
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return

  const schema = view.state.schema
  const imageBlockType = schema.nodes["image-block"]
  const imageType = schema.nodes["image"]
  if (!imageBlockType || !imageType) return

  const overTable = isDropOverTable(view, event)
  const insertPos = cellPosFromEvent(view, event)
  if (!overTable && insertPos == null) return
  const dragging = (view as any).dragging

  event.preventDefault()
  event.stopPropagation()

  const slice = dragging?.slice
  if (slice && slice.content.size > 0) {
    const inline = flattenToInline(slice.content, imageBlockType, imageType)
    if (!inline || insertPos == null) return
    const tr = view.state.tr
    if (dragging.move) {
      if (dragging.node) dragging.node.replace(tr)
      else tr.deleteSelection()
    }
    const pos = tr.mapping.map(insertPos)
    tr.replaceRange(pos, pos, new Slice(inline, 0, 0))
    const $pos = tr.doc.resolve(pos)
    tr.setSelection(TextSelection.near($pos))
    view.dispatch(tr.setMeta("uiEvent", "drop"))
    view.focus()
    return
  }

  const files = dataTransfer.files
  if (files.length && config.uploadImage) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        if (insertPos == null) return
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

export function createEditorDragDropPlugin(config: EditorDragDropConfig = {}) {
  let dragSource: Element | null = null

  return new Plugin({
    key: new PluginKey("inb4doc-editor-drag-drop"),
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(dropTargetKey)
        return meta === undefined ? value : meta
      },
    },
    view: (view) => {
      const onDrop = (event: DragEvent) => {
        dragSource = null
        handleCellDrop(view, event, config)
      }
      view.dom.addEventListener("drop", onDrop)

      const setDropTarget = (target: DropTarget | null) => {
        const current = dropTargetKey.getState(view.state)
        if (
          current?.from !== target?.from ||
          current?.to !== target?.to ||
          current?.rejected !== target?.rejected
        ) {
          view.dispatch(view.state.tr.setMeta(dropTargetKey, target))
        }
        const dropline = view.dom.parentNode?.querySelector(
          ".inb4doc-drop-cursor",
        )
        dropline?.classList.toggle("drop-reject", target?.rejected ?? false)
      }

      const contentIsCellValid = (event: DragEvent): boolean => {
        const schema = view.state.schema
        const imageBlockType = schema.nodes["image-block"]
        const imageType = schema.nodes["image"]
        const dragging = (view as any).dragging
        const slice = dragging?.slice
        if (slice && slice.content.size > 0 && imageBlockType && imageType) {
          return flattenToInline(slice.content, imageBlockType, imageType) != null
        }
        const files = event.dataTransfer?.files
        if (files && files.length > 0) {
          return Array.from(files).every(
            (f) => !f.type || f.type.startsWith("image/"),
          )
        }
        return true
      }

      const onDragOver = (event: DragEvent) => {
        if (!view.editable) return
        if (
          dragSource &&
          event.target instanceof Element &&
          (event.target === dragSource ||
            dragSource.contains(event.target) ||
            event.target.contains(dragSource))
        ) {
          setDropTarget(null)
          return
        }
        const x = event.clientX
        const y = event.clientY
        const cell = tableCellAtPoint(view, x, y)
        if (!cell) {
          const target = event.target as Element | null
          const block =
            target instanceof Element
              ? target.closest(".ProseMirror-table-node")
              : null
          if (block) event.preventDefault()
          const nearest = block
            ? nearestCellInBlock(block, x, y)
            : null
          if (nearest) {
            const range = cellNodeRange(view, nearest)
            if (range) {
              setDropTarget({ ...range, rejected: true })
              return
            }
          }
          setDropTarget(null)
          return
        }
        const range = cellNodeRange(view, cell)
        if (range) {
          event.preventDefault()
          const rejected = !contentIsCellValid(event)
          setDropTarget({ ...range, rejected })
        }
      }

      const onDragLeave = (event: DragEvent) => {
        const el = view.dom.ownerDocument.elementFromPoint(
          event.clientX,
          event.clientY,
        )
        if (el instanceof Element && el.closest(".ProseMirror-table-node")) return
        if (tableCellAtPoint(view, event.clientX, event.clientY, dragSource))
          return
        setDropTarget(null)
      }

      const onDragEnd = () => {
        dragSource = null
        setDropTarget(null)
      }
      view.dom.addEventListener("dragover", onDragOver)
      view.dom.addEventListener("dragleave", onDragLeave)
      view.dom.addEventListener("dragend", onDragEnd)

      const sweepTableCorruption = () => {
        if (view.isDestroyed) return
        const strays = Array.from(
          view.dom.querySelectorAll<HTMLElement>(
            ".ProseMirror-table-node [data-pm-slice]",
          ),
        )
        for (const stray of strays) {
          stray.remove()
        }
      }
      const corruptionObserver = new MutationObserver((records) => {
        if (view.isDestroyed) return
        const addedPmSlice = records.some((r) =>
          Array.from(r.addedNodes).some(
            (n) => n instanceof Element && n.matches("[data-pm-slice]"),
          ),
        )
        if (!(view as any).dragging && !dragSource && !addedPmSlice) return
        sweepTableCorruption()
      })
      corruptionObserver.observe(view.dom, { childList: true, subtree: true })

      let gesture: {
        from: number
        to: number
        slice: Slice
        startX: number
        startY: number
        started: boolean
        ghost: HTMLDivElement | null
      } | null = null

      const endGesture = () => {
        if (!gesture) return
        gesture.ghost?.remove()
        setDropTarget(null)
        gesture = null
        view.root.removeEventListener("pointermove", onPointerMove as EventListener)
        view.root.removeEventListener("pointerup", onPointerUp as EventListener)
        view.root.removeEventListener("pointercancel", onPointerCancel as EventListener)
        view.root.removeEventListener("dragstart", onDragStartBlock as EventListener, true)
      }

      const onPointerDown = (event: PointerEvent) => {
        if (!view.editable || event.button !== 0 || !event.isPrimary) return
        const rawTarget = event.target as EventTarget | null
        if (!rawTarget) return
        const target =
          rawTarget instanceof Element
            ? rawTarget
            : rawTarget instanceof Text
              ? rawTarget.parentElement
              : null
        if (!target) return
        if (!target.closest(".ProseMirror-table-node")) return
        if (
          target.closest(
            '.inb4doc-image-inline, .image-resize-handle, button, [data-role="col-drag-handle"], [data-role="row-drag-handle"]',
          )
        )
          return

        const { selection } = view.state
        if (!(selection instanceof TextSelection) || selection.empty) return
        if (!selection.$from.sameParent(selection.$to)) return

        const doc = view.dom.ownerDocument
        const domSel = doc.getSelection()
        if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return
        const caret = caretRangeAtPoint(doc, event.clientX, event.clientY)
        if (!caret) return
        const selRange = domSel.getRangeAt(0)
        const onSelection =
          caret.compareBoundaryPoints(Range.START_TO_START, selRange) >= 0 &&
          caret.compareBoundaryPoints(Range.START_TO_END, selRange) <= 0
        if (!onSelection) return

        gesture = {
          from: selection.from,
          to: selection.to,
          slice: selection.content(),
          startX: event.clientX,
          startY: event.clientY,
          started: false,
          ghost: null,
        }
        view.root.addEventListener("pointermove", onPointerMove as EventListener)
        view.root.addEventListener("pointerup", onPointerUp as EventListener)
        view.root.addEventListener("pointercancel", onPointerCancel as EventListener)
        view.root.addEventListener("dragstart", onDragStartBlock as EventListener, true)
      }

      const onPointerMove = (event: PointerEvent) => {
        if (!gesture) return
        event.preventDefault()
        if (!gesture.started) {
          const dx = Math.abs(event.clientX - gesture.startX)
          const dy = Math.abs(event.clientY - gesture.startY)
          if (dx + dy < 6) return
          gesture.started = true
          const text = view.state.doc.textBetween(
            gesture.from,
            gesture.to,
            "\n",
          )
          const ghost = view.dom.ownerDocument.createElement("div")
          ghost.className = "text-drag-ghost"
          ghost.textContent =
            text.length > 80 ? `${text.slice(0, 80)}…` : text
          view.dom.ownerDocument.body.appendChild(ghost)
          gesture.ghost = ghost
        }
        if (gesture.ghost) {
          gesture.ghost.style.left = `${event.clientX + 10}px`
          gesture.ghost.style.top = `${event.clientY + 14}px`
        }
        const cell = tableCellAtPoint(view, event.clientX, event.clientY)
        const range = cell ? cellNodeRange(view, cell) : null
        setDropTarget(range ? { ...range, rejected: false } : null)
      }

      const onPointerUp = (event: PointerEvent) => {
        const drag = gesture
        endGesture()
        if (!drag || !drag.started) return
        event.preventDefault()
        resolveTextDrop(view, drag, event.clientX, event.clientY)
      }

      const onPointerCancel = () => {
        endGesture()
      }

      const onDragStartBlock = (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
      }

      view.dom.addEventListener("pointerdown", onPointerDown, true)

      return {
        update: () => {
          sweepTableCorruption()
        },
        destroy: () => {
          corruptionObserver.disconnect()
          endGesture()
          setDropTarget(null)
          view.dom.removeEventListener("drop", onDrop)
          view.dom.removeEventListener("dragover", onDragOver)
          view.dom.removeEventListener("dragleave", onDragLeave)
          view.dom.removeEventListener("dragend", onDragEnd)
          view.dom.removeEventListener("pointerdown", onPointerDown, true)
        },
      }
    },
    props: {
      handleDOMEvents: {
        dragstart(view, event) {
          if (event.target instanceof Element) dragSource = event.target
          const dragging = (view as any).dragging
          if (dragging?.move && !dragging.node) {
            const { selection, doc } = view.state
            let from: number
            let to: number
            if (selection instanceof NodeSelection) {
              from = selection.from
              to = selection.to
            } else {
              const $from = doc.resolve(selection.from)
              const depth = Math.max(1, $from.depth)
              from = $from.before(depth)
              to = from + $from.node(depth).nodeSize
            }
            dragging.node = {
              replace: (tr: any) => {
                const mappedFrom = tr.mapping.map(from)
                const mappedTo = tr.mapping.map(to)
                tr.delete(mappedFrom, mappedTo)
              },
            }
          }
          return false
        },
      },
      decorations: (state) => {
        const target = dropTargetKey.getState(state)
        if (!target || target.rejected) return DecorationSet.empty
        const cell = state.doc.nodeAt(target.from)
        if (!cell) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.node(target.from, target.to, {
            class: "text-drop-target",
          }),
        ])
      },
      handleDrop: (view, event) => {
        if (!view.editable) return false
        if (!isDropOverTable(view, event)) return false
        event.preventDefault()
        event.stopPropagation()
        return true
      },
      handlePaste: (view, event, slice) => {
        if (!event.clipboardData) return false
        if (!isInsideTableCell(view.state.selection.$from)) return false

        const schema = view.state.schema
        const imageBlockType = schema.nodes["image-block"]
        const imageType = schema.nodes["image"]
        if (!imageBlockType || !imageType) return false
        if (!slice || slice.content.size === 0) return false

        const inline = flattenToInline(slice.content, imageBlockType, imageType)
        if (!inline) {
          event.preventDefault()
          return true
        }

        event.preventDefault()
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(inline, 0, 0))
            .setMeta("paste", true),
        )
        view.focus()
        return true
      },
    },
  })
}
