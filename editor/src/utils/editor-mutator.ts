/**
 * editor-mutator — shared ProseMirror document mutations.
 *
 * List operations delegate to ProseKit's `toggleList` command (via
 * prosemirror-flat-list) which handles wrap / convert / unwrap in one call.
 * Task checked-state toggling and list-item clearing still use direct node
 * surgery since they operate on individual items rather than whole lists.
 */

import type { Node } from "prosemirror-model"
import { TextSelection } from "prosemirror-state"
import type { EditorState } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createToggleListCommand } from "prosemirror-flat-list"

export type ListItemKind = "bullet" | "ordered" | "task"

export function setTaskChecked(view: EditorView, checked: boolean): void {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name !== "list") continue
    view.dispatch(
      view.state.tr.setNodeMarkup($from.before(d), undefined, {
        ...node.attrs,
        kind: "task",
        checked,
      }),
    )
    return
  }
}

/**
 * Toggle `checked` on the list items under the selection — the topbar
 * dropdown's "Check/Uncheck" item. The quick bar's
 * MarkTask/UnmarkTask set the state explicitly; this flips the covered items
 * only. A caret flips just its own item; a multi-item selection (drag or
 * Shift+arrows) flips every covered task item. Uses the same coverage rule as
 * the list-conversion code: an item counts when the selection touches its own
 * paragraph, never merely a nested list inside it.
 */
export function toggleTaskChecked(view: EditorView): void {
  const { state, dispatch } = view
  const { $from, $to } = state.selection
  const touched = collectTouchedLists(state, $from.pos, $to.pos)
  if (touched.length === 0) return
  const tr = state.tr
  let toggled = false
  for (const t of touched) {
    const curPos = tr.mapping.map(t.pos)
    const list = tr.doc.nodeAt(curPos)
    if (!list || list.type.name !== "list") continue
    if (typeof list.attrs.checked !== "boolean") continue
    tr.setNodeMarkup(curPos, undefined, {
      ...list.attrs,
      checked: !list.attrs.checked,
    })
    toggled = true
  }
  if (toggled) dispatch(tr.scrollIntoView())
}

/**
 * Unwrap the list items touched by the selection back into non-lists — the
 * dropdown's "Clear List Item". Every covered item's content (its paragraph
 * plus any nested blocks) replaces the item; the uncovered before/after items
 * stay in their own same-kind lists. Selection-wide, mirroring
 * `setListItemKind`'s coverage rules, so a multi-item selection clears every
 * touched list.
 */
export function clearListItems(view: EditorView): void {
  const { state, dispatch } = view
  const { $from, $to } = state.selection
  const from = $from.pos
  const to = $to.pos
  const touched = collectTouchedLists(state, from, to)
  if (touched.length === 0) return
  const tr = state.tr
  let caretPos: number | null = null
  for (const t of [...touched].sort((a, b) => a.pos - b.pos)) {
    const curPos = tr.mapping.map(t.pos)
    const list = tr.doc.nodeAt(curPos)
    if (!list || list.type.name !== "list") continue

    const before: Node[] = []
    const mid: Node[] = []
    const after: Node[] = []
    list.forEach((child, _offset, index) => {
      if (index < t.first) before.push(child)
      else if (index > t.last) after.push(child)
      else mid.push(child)
    })
    if (mid.length === 0) continue

    const beforeList =
      before.length > 0 ? list.type.create({ ...list.attrs }, before) : null
    const afterList =
      after.length > 0 ? list.type.create({ ...list.attrs }, after) : null
    const start = curPos
    const end = curPos + list.nodeSize
    tr.replaceWith(start, end, [beforeList, ...mid, afterList].filter((n): n is Node => n != null))
    if (caretPos === null) {
      caretPos = start + (beforeList?.nodeSize ?? 0) + 1
    }
  }
  if (tr.docChanged) {
    const safePos = Math.min(caretPos ?? from, tr.doc.content.size - 1)
    if (safePos >= 0) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(safePos)))
    }
    dispatch(tr.scrollIntoView())
  }
}

/**
 * Convert the current selection's list items into `kind`, or wrap in a list
 * if not inside one. Delegates to ProseKit's `toggleList` command for all
 * conversions (handles wrap and convert by merging attrs onto covered items,
 * like prosekit.dev's list extension). The only special case is toggling
 * while already inside a task list: instead of unwrapping, uncheck the
 * touched items.
 */
export function setListItemKind(
  view: EditorView,
  kind: ListItemKind,
): void {
  const { state, dispatch } = view
  const { $from, $to } = state.selection

  if (kind === "bullet" || kind === "ordered") {
    createToggleListCommand({ kind })(state, dispatch)
    return
  }

  // Task list: check if we're already inside a task list
  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list") {
      itemDepth = d
      break
    }
  }

  const currentList = itemDepth === -1 ? null : $from.node(itemDepth)

  if (!currentList || currentList.attrs.kind !== "task") {
    // Not in a list, or in a bullet/ordered list — toggleList wraps plain
    // blocks and converts existing items ({ ...oldAttrs, kind: "task",
    // checked: false } via the schema default), checkboxes included.
    createToggleListCommand({ kind: "task" })(state, dispatch)
    return
  }

  // Already in a task list — uncheck touched items instead of unwrapping.
  // Defensive path: the UI normally routes this through Check/Uncheck.
  const touched = collectTouchedLists(state, $from.pos, $to.pos)
  if (touched.length === 0) return
  const tr = state.tr
  let changed = false
  for (const t of touched) {
    const curPos = tr.mapping.map(t.pos)
    const list = tr.doc.nodeAt(curPos)
    if (!list || list.type.name !== "list") continue
    if (list.attrs.checked !== false) {
      tr.setNodeMarkup(curPos, undefined, { ...list.attrs, checked: false })
      changed = true
    }
  }
  if (changed) dispatch(tr.scrollIntoView())
}

interface TouchedList {
  node: Node
  pos: number
  first: number
  last: number
  firstOffset: number
}

function collectTouchedLists(state: EditorState, from: number, to: number): TouchedList[] {
  const touched: TouchedList[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "list") return true
    let first = -1
    let last = -1
    let firstOffset = 0
    node.forEach((child, offset, index) => {
      // In the flat model, each list item is a list node whose children are
      // direct blocks. Only count paragraphs — nested lists are visited
      // separately by nodesBetween and handled on their own.
      if (child.type.name !== "paragraph") return
      const paraStart = pos + 1 + offset
      const paraEnd = paraStart + child.nodeSize
      const covered =
        from === to ? paraStart <= from && from <= paraEnd : from < paraEnd && to > paraStart
      if (!covered) return
      if (first === -1) {
        first = index
        firstOffset = offset
      }
      last = index
    })
    if (first !== -1) touched.push({ node, pos, first, last, firstOffset })
    return true
  })
  return touched
}
