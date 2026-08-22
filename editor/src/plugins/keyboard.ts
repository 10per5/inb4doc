import { undo, redo } from "prosemirror-history"
import { TextSelection, NodeSelection, Plugin, PluginKey, Selection } from "prosemirror-state"
import { toggleMark, setBlockType, exitCode } from "prosemirror-commands"
import { createToggleListCommand, createIndentListCommand } from "prosemirror-flat-list"
import { defineKeymap } from "@prosekit/core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { isInsideTableCell } from "@/plugins/editor-drag-drop"

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
  if (!parentItem || parentItem.type.name !== "list") return false
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
    if ($from.node(d).type.name === "list") {
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
    if ($from.node(d).type.name === "list") {
      return $from.before(d)
    }
  }
  return $from.depth >= 1 ? $from.before(1) : null
}

// Ctrl+Enter inserts an empty paragraph below the block the caret is in,
// regardless of where the caret sits inside the block, and focuses it. A
// "block" is the top-level node (paragraph, heading, blockquote, ...) or,
// inside a list, the list item — the same units findBlockStart treats as a
// block. Handled here (not the default baseKeymap's Mod-Enter → exitCode, which
// only applies to code blocks) so it works from any position inside the block.
function insertBlockBelow(
  state: any,
  dispatch: any,
): boolean {
  const { $from } = state.selection
  let endPos: number | null = null
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list") {
      endPos = $from.after(d)
      break
    }
  }
  if (endPos === null && $from.depth >= 1) {
    endPos = $from.after(1)
  }
  if (endPos === null) return false
  const paragraph = state.schema.nodes.paragraph
  const tr = state.tr.insert(endPos, paragraph.create())
  tr.setSelection(TextSelection.near(tr.doc.resolve(endPos)))
  if (dispatch) dispatch(tr.scrollIntoView())
  return true
}

// Ctrl+X with no selection → cut the whole current block (a bullet point cuts
// the item, a paragraph cuts the paragraph). ProseMirror has no Mod-x binding —
// the browser only cuts a real DOM selection — so we select the block as a
// NodeSelection and let prosemirror-view's own cut handler (serialize
// selection → clipboard, deleteSelection) do the rest with full markdown/html
// fidelity. With a real selection the native path is left untouched.
let _editorView: import("prosemirror-view").EditorView | null = null

export function setEditorView(view: import("prosemirror-view").EditorView) {
  _editorView = view
}

function cutBlock(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const pos = findBlockStart($from)
  if (pos === null || !dispatch || !_editorView) return false

  const tr = state.tr.setSelection(NodeSelection.create(state.doc, pos))
  dispatch(tr)

  _editorView.focus()
  const dom = _editorView.nodeDOM(pos)
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

// ProseKit registers the inline-code mark under `code`.
function codeMark(state: any): any {
  return state.schema.marks.code
}

// ProseMirror keeps the code mark "stored" at a mark boundary with no
// character on the other side (block end/start), so typing there stays
// code-styled. At a block end there is no position outside the mark — break
// out = clear the stored marks and STAY (jumping would land on the next
// block). Mid-block the caret is already outside, so navigation stays native.
function exitInlineCode(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const codeType = codeMark(state)
  if (!codeType) return false
  const from = $from.pos
  const start = $from.start()
  const end = $from.end()
  if (from <= start) return false
  if (!state.doc.rangeHasMark(from - 1, from, codeType)) return false
  if (from < end) return false
  if (dispatch) dispatch(state.tr.setStoredMarks([]))
  return true
}

// Mirror for the start boundary: ArrowLeft on a block-start code span clears
// the stored mark and stays.
function enterInlineCodeFromLeft(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const codeType = codeMark(state)
  if (!codeType) return false
  const from = $from.pos
  const start = $from.start()
  const end = $from.end()
  if (from >= end) return false
  if (!state.doc.rangeHasMark(from, from + 1, codeType)) return false
  if (start < from) return false
  if (dispatch) dispatch(state.tr.setStoredMarks([]))
  return true
}

// Home/End to a block edge that touches inline code: move the caret there and
// clear the stored mark so typing before/after the span is plain.
function homeToBlockStart(state: any, dispatch: any): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const codeType = codeMark(state)
  if (!codeType) return false
  const start = $from.start()
  if ($from.pos === start) return false
  if (!state.doc.rangeHasMark(start, start + 1, codeType)) return false
  if (dispatch) {
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, start))
        .setStoredMarks([])
        .scrollIntoView(),
    )
  }
  return true
}

function endToBlockEnd(state: any, dispatch: any): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false
  const codeType = codeMark(state)
  if (!codeType) return false
  const end = $from.end()
  if ($from.pos === end) return false
  if (!state.doc.rangeHasMark(end - 1, end, codeType)) return false
  if (dispatch) {
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, end))
        .setStoredMarks([])
        .scrollIntoView(),
    )
  }
  return true
}

// ── codeBlock key handling ───────────────────────────────────────────

function isInsideCodeBlock($from: any): boolean {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "codeBlock") return true
  }
  return false
}

// Tab / Shift-Tab inside a code block: indent/dedent every line touched by the
// selection by `tabSize` real spaces (NBSPs would leak into markdown output).
// Lines are processed bottom-up so earlier positions stay valid.
function codeIndent(
  state: any,
  dispatch: ((tr: any) => void) | undefined,
  dir: -1 | 1,
): boolean {
  const { $from } = state.selection
  if (!isInsideCodeBlock($from)) return false

  const blockStart = $from.start()
  const blockEnd = $from.end()
  const selFrom = Math.min(state.selection.from, state.selection.to)
  const selTo = Math.max(state.selection.from, state.selection.to)

  // Absolute offsets of every line start in the block.
  const text = state.doc.textBetween(blockStart, blockEnd, "\n")
  const starts: number[] = [blockStart]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(blockStart + i + 1)
  }

  const tabSize = 2
  let tr = state.tr
  let changed = false
  for (let i = starts.length - 1; i >= 0; i--) {
    const lineStart = starts[i]
    const lineEnd =
      i + 1 < starts.length ? starts[i + 1] : blockEnd
    const overlaps = selFrom <= lineEnd && selTo >= lineStart
    if (!overlaps) continue

    if (dir === 1) {
      tr.insertText(" ".repeat(tabSize), lineStart, lineStart)
      changed = true
    } else {
      const head = state.doc.textBetween(
        lineStart,
        Math.min(lineStart + tabSize, lineEnd),
        "\n",
      )
      const spaces = head.match(/^ +$/)?.[0].length ?? 0
      if (spaces > 0) {
        tr.delete(lineStart, lineStart + spaces)
        changed = true
      }
    }
  }
  if (!changed) return true
  if (dispatch) {
    const mappedFrom = tr.mapping.map(selFrom)
    const mappedTo = tr.mapping.map(selTo)
    tr.setSelection(TextSelection.create(tr.doc, mappedFrom, mappedTo))
    dispatch(tr.scrollIntoView())
  }
  return true
}

// Backspace at position 0 of a single-line code block converts it to a
// paragraph keeping the text — same UX the old prism-based node view had.
// Multi-line blocks keep native join behavior.
function backspaceCodeBlockToParagraph(
  state: any,
  dispatch: any,
): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  if ($from.parent.type.name !== "codeBlock") return false
  if ($from.parent.textContent.includes("\n")) return false
  return setBlockType(state.schema.nodes.paragraph)(state, dispatch)
}

// Vertical entry into a code block must be deterministic. PM's own
// selectVertically only applies NodeSelections and otherwise lets the BROWSER
// move the caret; browsers preserve the goal X-column, so leaving a wide
// heading into a narrow monospace block clamps the caret to the line END
// (or worse on multi-press). Take over at the boundary: place the caret at
// the block start (Down) / block end (Up) whenever the text-only neighbor is
// a code block. Non-code neighbors keep native behavior.
function enterCodeBlockVertically(
  state: any,
  dispatch: any,
  view: any,
  dir: -1 | 1,
): boolean {
  const { empty, $to } = state.selection
  if (!empty || !view || !($to.parent.inlineContent)) return false
  if (state.selection instanceof NodeSelection) return false
  if (!view.endOfTextblock(dir < 0 ? "up" : "down")) return false

  let $edge: any
  try {
    $edge = state.doc.resolve(dir > 0 ? $to.after() : $to.before())
  } catch {
    return false
  }
  const next = Selection.findFrom($edge, dir, true) // text-only positions
  if (!next || !(next instanceof TextSelection)) return false
  if (!next.$head.parent.type.spec.code) return false

  if (dispatch) {
    dispatch(state.tr.setSelection(next).scrollIntoView())
  }
  return true
}

export function createKeymap() {
  return defineKeymap({
    "Mod-b": (state, dispatch) => toggleMark(state.schema.marks.bold)(state, dispatch),
    "Mod-B": (state, dispatch) => toggleMark(state.schema.marks.bold)(state, dispatch),
    "Mod-i": (state, dispatch) => toggleMark(state.schema.marks.italic)(state, dispatch),
    "Mod-I": (state, dispatch) => toggleMark(state.schema.marks.italic)(state, dispatch),
    "Mod-`": (state, dispatch) => toggleMark(codeMark(state))(state, dispatch),
    "Mod-Shift-s": (state, dispatch) => toggleMark(state.schema.marks.strike)(state, dispatch),
    "Mod-Shift-x": (state, dispatch) => toggleMark(state.schema.marks.strike)(state, dispatch),
    "Mod-Alt-1": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 1 })(state, dispatch),
    "Mod-Alt-2": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 2 })(state, dispatch),
    "Mod-Alt-3": (state, dispatch) => setBlockType(state.schema.nodes.heading, { level: 3 })(state, dispatch),
    "Mod-Shift-7": createToggleListCommand({ kind: "bullet" }),
    "Mod-Shift-8": createToggleListCommand({ kind: "ordered" }),
    "Mod-Shift--": (state, dispatch) => {
      const hr = state.schema.nodes.horizontalRule.create()
      const tr = state.tr.replaceSelectionWith(hr)
      if (dispatch) dispatch(tr.scrollIntoView())
      return true
    },
    "Mod-z": (state, dispatch) => undo(state, dispatch),
    "Mod-Z": (state, dispatch) => redo(state, dispatch),
    "Mod-y": (state, dispatch) => redo(state, dispatch),
    "Mod-x": (state, dispatch) => cutBlock(state, dispatch),
    "Mod-Enter": (state, dispatch) => {
      // Inside a code block Mod-Enter exits it (legacy prism-editor behavior);
      // elsewhere it inserts an empty paragraph below the current block.
      if (isInsideCodeBlock(state.selection.$from)) return exitCode(state, dispatch)
      return insertBlockBelow(state, dispatch)
    },
    // A GFM table cell holds exactly one paragraph, so Enter can't split into a
    // second paragraph. The gfm preset binds plain Enter to `exitTable` (same as
    // Ctrl+Enter) — too aggressive. Ours runs first, so consume Enter inside a
    // cell and insert a hard break (`<br>`), which the cell does support. Shift-
    // Enter keeps working via the base keymap.
    "Enter": (state, dispatch) => {
      if (!isInsideTableCell(state.selection.$from)) return false
      const hardbreak = state.schema.nodes.hardBreak
      if (!hardbreak) return false
      if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(hardbreak.create()).scrollIntoView())
      }
      return true
    },
    // Stock PM sinkListItem returns false when the item is the FIRST child of
    // its parent list (startIndex == 0), so Tab indents when the item can sink
    // and otherwise inserts 4 non-breaking spaces. The edit-toolbar increase
    // button mirrors this: disabled when the item can't sink. This keymap runs
    // before Milkdown's listItemKeymap, so Tab is taken.
    "Tab": (state, dispatch) => {
      // Inside a cell, Tab must fall through to the gfm table keymap's
      // next-cell navigation instead of being swallowed here.
      if (isInsideTableCell(state.selection.$from)) return false
      // Inside a code block, Tab indents the touched lines with real spaces.
      if (isInsideCodeBlock(state.selection.$from)) {
        return codeIndent(state, dispatch, 1)
      }
      let itemDepth = -1
      for (let d = state.selection.$from.depth; d > 0; d--) {
        if (state.selection.$from.node(d).type.name === "list") {
          itemDepth = d
          break
        }
      }
      const canSink =
        itemDepth !== -1 && state.selection.$from.index(itemDepth - 1) > 0
      if (canSink) {
        return createIndentListCommand()(state, dispatch)
      }
      if (dispatch) dispatch(state.tr.insertText("\u00A0\u00A0\u00A0\u00A0"))
      return true
    },
    "Shift-Tab": (state, dispatch) => {
      if (isInsideCodeBlock(state.selection.$from)) {
        return codeIndent(state, dispatch, -1)
      }
      return false
    },
    "ArrowDown": (state, dispatch, view) =>
      enterCodeBlockVertically(state, dispatch, view, 1),
    "ArrowUp": (state, dispatch, view) =>
      enterCodeBlockVertically(state, dispatch, view, -1),
    "Mod-ArrowUp": (state, dispatch) => moveBlock(state, dispatch, -1),
    "Mod-ArrowDown": (state, dispatch) => moveBlock(state, dispatch, 1),
    "ArrowLeft": (state, dispatch) => enterInlineCodeFromLeft(state, dispatch),
    "ArrowRight": (state, dispatch) => exitInlineCode(state, dispatch),
    "Home": (state, dispatch) => homeToBlockStart(state, dispatch),
    "End": (state, dispatch) => endToBlockEnd(state, dispatch),
    "Backspace": (state, dispatch) => {
      if (backspaceCodeBlockToParagraph(state, dispatch)) return true
      return headingToParagraph(state, dispatch)
    },
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
