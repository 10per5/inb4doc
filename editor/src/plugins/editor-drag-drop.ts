import type { Ctx } from "@milkdown/kit/ctx"
import { dropIndicatorConfig } from "@milkdown/kit/plugin/cursor"
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state"
import { Fragment, Slice, type Node, type NodeType, type ResolvedPos } from "@milkdown/kit/prose/model"
import { dropPoint } from "@milkdown/kit/prose/transform"
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view"
import { encodeAlt } from "@/plugins/image-resize"

export interface EditorDragDropConfig {
  uploadImage?: (file: File) => Promise<string>
}

/**
 * Configure Milkdown's drop indicator (the dropline overlay) for the dnd
 * plugin. The class here is the handle the plugin toggles `drop-reject` on,
 * so the indicator color is controlled from `dnd.css`, not from the editor
 * config.
 */
export function configureDropIndicator(ctx: Ctx): void {
  ctx.update(dropIndicatorConfig.key, () => ({
    class: "inb4doc-drop-cursor",
    width: 4,
    color: false as const,
  }))
}

/**
 * The cell currently under a drag, held in plugin state. The drop-target
 * styling is derived from this on every `updateState` via the plugin's
 * `decorations` prop, which PM applies to the cell node's own DOM (the
 * `td`/`th`) and re-applies after any view re-render or node-view re-mount —
 * so the highlight can't be wiped the way imperative `classList` edits are.
 */
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
 * The `td`/`th` element under the given viewport point, when it belongs to a
 * table inside the editor. Resolving cells from DOM geometry (`elementFromPoint`
 * + an ancestor walk) is more reliable than `posAtCoords`, which frequently
 * resolves to the wrong cell or the cell boundary. When the point lands on the
 * table wrapper/padding/handle instead of a cell (common at cell/table
 * borders), fall back to geometry: the cell that contains the point, or the
 * nearest cell within a small margin.
 */
function tableCellAtPoint(
  view: EditorView,
  x: number,
  y: number,
): Element | null {
  const el = view.dom.ownerDocument.elementFromPoint(x, y) as Element | null
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

/**
 * The `td`/`th` closest to the given point within `block`, without the 24px
 * cap that `tableCellAtPoint` applies. Used when the pointer is on the table
 * wrapper/borders/handles far from any cell: the rejected modifier still
 * targets a real cell instead of the whole block.
 */
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

/**
 * Position inside the first paragraph of the cell under the given point.
 * More reliable than `posAtCoords` for tables.
 */
function cellPosFromEvent(view: EditorView, event: DragEvent): number | null {
  const cell = tableCellAtPoint(view, event.clientX, event.clientY)
  if (!cell) return null
  const pos = view.posAtDOM(cell, 0)
  if (pos == null) return null
  return cellInsertPos(view.state.doc.resolve(pos))
}

/**
 * Document range of the `table_cell`/`table_header` node that owns the given
 * DOM cell. Used to target the node decoration for the drop-target highlight.
 */
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

/**
 * Collapsed range at the caret position for a viewport point, for whatever the
 * engine supports (`caretRangeFromPoint` on Chromium/Safari, falling back to
 * `caretPositionFromPoint` on Firefox). Used to tell whether a pointer press
 * landed inside the current DOM text selection.
 */
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

/**
 * Perform the actual move for a manually tracked text drag: delete the source
 * selection and insert the captured slice at the resolved target, as a single
 * `uiEvent: "drop"` transaction (so it undoes as one step). No-op when the
 * target lands on the source selection itself.
 *
 * The target is never a table-level or cell-boundary position: a cell is
 * resolved to the first paragraph inside it (`cellInsertPos`), and a doc-level
 * drop uses PM's `dropPoint` so the slice only lands at a position that accepts
 * it — inline text dropped at a block boundary would otherwise restructure the
 * block (splitting a table row and ejecting its content).
 */
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
      // The DOM hit-test missed the td/th but the resolved position is still
      // inside a cell — anchor inside its paragraph.
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

/**
 * Flatten a fragment to pure inline content so it can be inserted into a table
 * cell's paragraph. Whitelist for what may enter a cell:
 *
 * - inline nodes (text + marks, inline `image`, `hard_break`) pass through;
 * - `image-block` becomes an inline `image` (size persisted via the alt
 *   encoding);
 * - text blocks/containers — paragraph, heading, code_block, list items and
 *   lists, blockquote, alert — are reduced to their inline content, so an
 *   entire bullet point or heading lands in the cell as text. Consecutive
 *   source blocks are joined with a hard break (`<br>`) — the standard
 *   markdown way to represent multiple lines inside a GFM table cell.
 *
 * Anything else (`video`, `table`, `horizontal_rule`, `divCenter`, unknown
 * atom blocks) makes the whole fragment invalid for a cell: returns `null`
 * and the drop/paste becomes a no-op.
 */
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
    const hardBreak = node.type.schema.nodes["hardbreak"]
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
      name === "list_item" ||
      name === "bullet_list" ||
      name === "ordered_list" ||
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

/**
 * Handle a drop whose target is inside a table cell. ProseMirror never sees
 * drag/drop events over tables: the `tableBlock` node view's `stopEvent`
 * returns true for them, which makes `eventBelongsToView` reject the event
 * before any `handleDrop` prop (or the drop cursor) runs. So this listener is
 * bound directly on the editor view's DOM, where it runs after PM's own
 * (silently skipped) listener.
 */
/**
 * Whether a drop at the given event is over the table at all. Checks both the
 * DOM target (inside the `.milkdown-table-block` wrapper, e.g. on the add-row
 * bar or drag handles where no `td`/`th` sits) and the geometry cell lookup.
 * Drops over the table must never reach ProseMirror, which would insert at the
 * cell/table boundary or at an invalid depth.
 */
function isDropOverTable(view: EditorView, event: DragEvent): boolean {
  const target = event.target
  if (target instanceof Element && target.closest(".milkdown-table-block")) {
    return true
  }
  return tableCellAtPoint(view, event.clientX, event.clientY) != null
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

  // Every drop that lands on the table — a cell, the wrapper, the borders, or
  // (via geometry) the 24px band around it — is consumed here so it never
  // reaches PM's default drop handling or the browser's native drop.
  // Otherwise a dragged block that can't fit inside a cell (video, table,
  // hr, unknown atom) falls through to PM, which inserts it at the
  // cell/table boundary: orphaning the node view into the table wrapper or
  // splitting the table in two.
  event.preventDefault()
  event.stopPropagation()

  // In-editor drag of content (an image, text, or anything else): flatten to
  // inline cell content and insert. `view.dragging` is only ever set when the
  // drag started outside the table (PM's dragstart never runs inside one),
  // which is exactly the case that reaches here with a usable slice.
  const dragging = (view as any).dragging
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

  // OS file drop of an image into a cell.
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
      const onDrop = (event: DragEvent) => handleCellDrop(view, event, config)
      view.dom.addEventListener("drop", onDrop)

      const setDropTarget = (target: DropTarget | null) => {
        // The reject signal lives on the dropline overlay (the drop indicator
        // div milkdown appends to the editor's parent, styled in dnd.css).
        // Toggling here avoids fighting PM over editor-DOM classes. The class
        // is toggled unconditionally — the state guard only skips redundant
        // dispatches, because the read-back is unreliable (getState returns
        // `undefined` even right after `apply` stored a value), so guarding the
        // toggle on it would leave a stale red dropline over a valid target.
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
        const cell = tableCellAtPoint(view, event.clientX, event.clientY)
        if (!cell) {
          // Pointer is on the table wrapper / borders / padding where no
          // td/th sits. A border drop can never resolve a cell, so reject the
          // nearest cell to give visible feedback instead of nothing.
          const target = event.target as Element | null
          const block =
            target instanceof Element
              ? target.closest(".milkdown-table-block")
              : null
          const nearest = block
            ? nearestCellInBlock(block, event.clientX, event.clientY)
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
          setDropTarget({
            ...range,
            rejected: !contentIsCellValid(event),
          })
        }
      }

      const onDragLeave = (event: DragEvent) => {
        // Native drag fires `dragleave` on every element-boundary crossing
        // inside the table (th→td, cell→cell) and it bubbles to the view,
        // wiping the drop-target highlight a frame after each `dragover`
        // sets it — so the red/blue signal flickers off during a real drag.
        // Only clear when the pointer is genuinely off the table region.
        const el = view.dom.ownerDocument.elementFromPoint(
          event.clientX,
          event.clientY,
        )
        if (el instanceof Element && el.closest(".milkdown-table-block")) return
        if (tableCellAtPoint(view, event.clientX, event.clientY)) return
        setDropTarget(null)
      }

      view.dom.addEventListener("dragover", onDragOver)
      view.dom.addEventListener("dragleave", onDragLeave)
      view.dom.addEventListener("dragend", () => setDropTarget(null))

      /**
       * Manual (pointer-based) drag of a text selection OUT of a table cell.
       * Native drag-and-drop is dead inside tables: the tableBlock node view
       * swallows every drag/drop event via `stopEvent`, and the component root
       * calls `preventDefault()` on `dragstart`, so neither the browser nor PM
       * can start a native text drag. Instead, this gesture tracks pointer
       * events on the editor root for the duration of the press:
       *
       * - `pointerdown` arms the gesture only when the press lands on a
       *   non-empty, single-paragraph text selection inside a cell.
       * - `pointermove` past a small threshold starts the drag: a floating
       *   ghost follows the cursor and the cell under it is highlighted.
       * - `pointerup` resolves the drop target (a cell via `posAtDOM`, or a
       *   plain doc position via `posAtCoords`) and dispatches one move
       *   transaction — delete the source, insert the slice — tagged
       *   `uiEvent: "drop"` so it undoes as a single step.
       *
       * A capture-phase `dragstart` blocker is armed on the editor root for
       * the gesture's lifetime so no native drag can slip through and double-
       * apply the move.
       */
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
        if (!target.closest(".milkdown-table-block")) return
        if (
          target.closest(
            '.milkdown-image-inline, .image-resize-handle, button, [data-role="col-drag-handle"], [data-role="row-drag-handle"]',
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
        update: () => {},
        destroy: () => {
          endGesture()
          setDropTarget(null)
          view.dom.removeEventListener("drop", onDrop)
          view.dom.removeEventListener("dragover", onDragOver)
          view.dom.removeEventListener("dragleave", onDragLeave)
          view.dom.removeEventListener("dragend", () => setDropTarget(null))
          view.dom.removeEventListener("pointerdown", onPointerDown, true)
        },
      }
    },
    props: {
      handleDOMEvents: {
        // PM seeds `view.dragging` at dragstart but only attaches a
        // `node.replace` deleter when the drag began on a node
        // (NodeSelection). For a plain text-selection drag `view.dragging.node`
        // stays null, so PM's drop handler falls back to `tr.deleteSelection()`
        // (deletes nothing at the target) and the move silently becomes a
        // copy. Attach the source-range deleter here so text drags move
        // instead. PM's `dragstart` never runs for drags that START inside a
        // table (the tableBlock `stopEvent` swallows them) — those are handled
        // by the pointer gesture below.
        dragstart(view, event) {
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
      // The drop-target highlight, derived from plugin state on every
      // `updateState`. PM applies the decoration's class to the cell node's
      // own DOM (the `td`/`th`) and re-applies it after any re-render or
      // node-view re-mount, which is why the accent signal survives a real
      // drag in a way that ad-hoc `classList` edits never could. Rejected
      // drops paint nothing here — the dropline overlay turns red instead
      // (see `setDropTarget`).
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
      // Drops that land on the table (a cell, the wrapper, the borders, or
      // within the geometry band around it) must never reach PM's default
      // handling. PM's own drop listener is registered on `view.dom` before
      // this plugin's, so for drops whose target sits just OUTSIDE the
      // `.milkdown-table-block` wrapper (the "split the table" case) this
      // `handleDrop` prop is the only hook that runs before PM inserts the
      // dragged block at the table boundary. Returns true → PM consumes the
      // event; the view.dom `drop` listener above then does the real cell
      // insertion (or rejects when the content can't fit in a cell).
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

        // Flatten to inline cell content. Content that can't become cell text
        // (video, table, ...) is swallowed as a no-op instead of being pasted
        // in a way that would restructure the cell.
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
