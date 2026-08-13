import { keymap } from "@milkdown/kit/prose/keymap"
import { undo, redo } from "@milkdown/kit/prose/history"
import { TextSelection, NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state"
import { toggleMark, setBlockType } from "prosemirror-commands"
import { wrapInList, sinkListItem } from "prosemirror-schema-list"
import { appEvents, AppEvent } from "@/stores/app-events"

// When the caret sits at the start of a list item's first textblock (e.g.
// after Home), Milkdown binds both Backspace and Delete to `liftFirstListItem`
// which runs joinBackward — so Delete removes the list structure instead of
// deleting the next character. Our keymap plugin runs before Milkdown's
// internal keymap, so intercept Delete here and delete the char forward.
function deleteAtListItemStart(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  if ($from.parent.content.size === 0) return false
  const parentItem = $from.node(-1)
  if (!parentItem || parentItem.type.name !== "list_item") return false
  if (dispatch) {
    dispatch(state.tr.delete($from.pos, $from.pos + 1).scrollIntoView())
  }
  return true
}

function moveBlock(
  state: any,
  dispatch: any,
  dir: -1 | 1,
): boolean {
  const { $from } = state.selection
  if ($from.depth < 1) return false

  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") {
      itemDepth = d
      break
    }
  }
  if (itemDepth === -1) {
    itemDepth = 1
  }

  const parentDepth = itemDepth - 1
  const parentNode = $from.node(parentDepth)
  const itemStart = $from.before(itemDepth)
  const contentBase = parentDepth === 0 ? 0 : $from.before(parentDepth) + 1

  const itemIndex = $from.index(itemDepth - 1)
  const targetIndex = itemIndex + dir
  if (targetIndex < 0 || targetIndex >= parentNode.childCount) return false

  const node = parentNode.child(itemIndex)
  const size = node.nodeSize
  const tr = state.tr
  tr.delete(itemStart, itemStart + size)

  let offBeforeTarget = 0
  for (let j = 0; j < targetIndex; j++) {
    offBeforeTarget += parentNode.child(j).nodeSize
  }
  const targetSize = parentNode.child(targetIndex).nodeSize

  let insertPos: number
  if (dir === -1) {
    insertPos = contentBase + offBeforeTarget
  } else {
    insertPos = contentBase + offBeforeTarget - size + targetSize
  }

  tr.insert(insertPos, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))

  if (dispatch) dispatch(tr.scrollIntoView())
  return true
}

// Milkdown's DowngradeHeading keymap steps heading level down one `#` at a
// time on Backspace/Delete at the line start (## → # → paragraph). Skip the
// intermediate passes: convert straight to a paragraph so the next press
// deletes the line.
function headingToParagraph(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  if ($from.parent.type.name !== "heading") return false
  return setBlockType(state.schema.nodes.paragraph)(state, dispatch)
}

// Find the block a caret sits in, to cut it whole. Inside a list the "block" is
// the list item (marker + content), matching the Shift+Home whole-item view;
// elsewhere it is the top-level block (paragraph, heading, blockquote, ...).
// Returns the document position of the block's start, or null when the caret is
// directly in the doc (nothing meaningful to cut).
function findBlockStart($from: any): number | null {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") {
      return $from.before(d)
    }
  }
  return $from.depth >= 1 ? $from.before(1) : null
}

// Ctrl+X with no selection → cut the whole current block (a bullet point cuts
// the item, a paragraph cuts the paragraph). ProseMirror has no Mod-x binding —
// the browser only cuts a real DOM selection — so this selects the block as a
// NodeSelection and lets prosemirror-view's own cut handler (serialize
// selection → clipboard, deleteSelection) do the rest with full markdown/html
// fidelity. With a real selection the native path is left untouched.
function cutBlock(
  state: any,
  dispatch: any,
  view: { focus: () => void; nodeDOM: (pos: number) => Node | null } | undefined,
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const pos = findBlockStart($from)
  if (pos === null || !dispatch || !view) return false

  const tr = state.tr.setSelection(NodeSelection.create(state.doc, pos))
  dispatch(tr)

  view.focus()
  const dom = view.nodeDOM(pos)
  if (dom) {
    const range = document.createRange()
    range.selectNodeContents(dom)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  document.execCommand("cut")
  return true
}

export function createKeymap() {
  return keymap({
    "Mod-b": (state, dispatch) => toggleMark(state.schema.marks.strong)(state, dispatch),
    "Mod-B": (state, dispatch) => toggleMark(state.schema.marks.strong)(state, dispatch),
    "Mod-i": (state, dispatch) => toggleMark(state.schema.marks.em)(state, dispatch),
    "Mod-I": (state, dispatch) => toggleMark(state.schema.marks.em)(state, dispatch),
    "Mod-`": (state, dispatch) => toggleMark(state.schema.marks.code)(state, dispatch),
    "Mod-Shift-s": (state, dispatch) => toggleMark(state.schema.marks.strikethrough)(state, dispatch),
    "Mod-Shift-x": (state, dispatch) => toggleMark(state.schema.marks.strikethrough)(state, dispatch),
    "Mod-Alt-1": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 1 })(state, dispatch),
    "Mod-Alt-2": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 2 })(state, dispatch),
    "Mod-Alt-3": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 3 })(state, dispatch),
    "Mod-Shift-7": (state, dispatch) => wrapInList(state.schema.nodes.ordered_list)(state, dispatch),
    "Mod-Shift-8": (state, dispatch) => wrapInList(state.schema.nodes.bullet_list)(state, dispatch),
    "Mod-Shift--": (state, dispatch) => {
      const hr = state.schema.nodes.hr.create()
      const tr = state.tr.replaceSelectionWith(hr)
      if (dispatch) dispatch(tr.scrollIntoView())
      return true
    },
    "Mod-z": (state, dispatch) => undo(state, dispatch),
    "Mod-Z": (state, dispatch) => redo(state, dispatch),
    "Mod-y": (state, dispatch) => redo(state, dispatch),
    "Mod-x": (state, dispatch, view) => cutBlock(state, dispatch, view),
    // Stock PM sinkListItem returns false when the item is the FIRST child of
    // its parent list (startIndex == 0), so Tab indents when the item can sink
    // and otherwise inserts 4 non-breaking spaces. The edit-toolbar increase
    // button mirrors this: disabled when the item can't sink. This keymap runs
    // before Milkdown's listItemKeymap, so Tab is taken.
    "Tab": (state, dispatch) => {
      let itemDepth = -1
      for (let d = state.selection.$from.depth; d > 0; d--) {
        if (state.selection.$from.node(d).type.name === "list_item") {
          itemDepth = d
          break
        }
      }
      const canSink =
        itemDepth !== -1 && state.selection.$from.index(itemDepth - 1) > 0
      if (canSink) {
        return sinkListItem(state.schema.nodes.list_item)(state, dispatch)
      }
      if (dispatch) dispatch(state.tr.insertText("\u00A0\u00A0\u00A0\u00A0"))
      return true
    },
    "Mod-ArrowUp": (state, dispatch) => moveBlock(state, dispatch, -1),
    "Mod-ArrowDown": (state, dispatch) => moveBlock(state, dispatch, 1),
    "Backspace": (state, dispatch) => headingToParagraph(state, dispatch),
    "Delete": (state, dispatch) => {
      if (deleteAtListItemStart(state, dispatch)) return true
      return headingToParagraph(state, dispatch)
    },
  })
}

const codeBlockMoveKey = new PluginKey("code-block-block-move")

export function createCodeBlockMovePlugin() {
  return new Plugin({
    key: codeBlockMoveKey,
    view: (view) => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        const target = event.target as HTMLElement | null
        if (!target || !target.closest(".code-block-wrapper")) return
        const dir = event.key === "ArrowUp" ? -1 : 1
        if (moveBlock(view.state, view.dispatch, dir)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      view.dom.addEventListener("keydown", onKeyDown, true)
      return {
        destroy: () => view.dom.removeEventListener("keydown", onKeyDown, true),
      }
    },
  })
}

// ── Global key bindings ──────────────────────────────────────────────
// Single owner of document-level keydown listeners. All global key handling
// is declared here as a static list; handlers emit app events so controllers
// subscribe to intent instead of binding their own document listeners.

const globalKeyBindings: ReadonlyArray<{
  matches: (e: KeyboardEvent) => boolean
  handler: (e: KeyboardEvent) => void
}> = [
  {
    matches: (e) => e.key === "Escape",
    handler: () => appEvents.emit(AppEvent.SidebarCancel),
  },
]

function dispatchGlobalKey(event: KeyboardEvent): void {
  for (const binding of globalKeyBindings) {
    if (binding.matches(event)) binding.handler(event)
  }
}

document.addEventListener("keydown", dispatchGlobalKey)
