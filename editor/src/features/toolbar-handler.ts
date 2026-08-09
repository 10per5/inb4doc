/**
 * toolbar-handler — subscribes to ToolbarCommandExec events and dispatches
 * Milkdown commands. Receives an editor getter; imports services lazily.
 *
 * No static imports of editorContext or commandService — both are
 * dynamically imported inside the handler to keep the main bundle free.
 */

import type { Editor } from "@milkdown/kit/core"
import type { EditorView } from "@milkdown/kit/prose/view"
import type { Node, Schema } from "@milkdown/kit/prose/model"
import { TextSelection } from "@milkdown/kit/prose/state"
import type { EditorState, Transaction } from "@milkdown/kit/prose/state"
import type { CmdKey } from "@milkdown/core"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"

function setTaskChecked(view: EditorView, checked: boolean): void {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name !== "list_item") continue
    view.dispatch(
      view.state.tr.setNodeMarkup($from.before(d), undefined, {
        ...node.attrs,
        checked,
      }),
    )
    return
  }
}

interface ListCommands {
  call: (key: string | CmdKey<unknown>, ...args: unknown[]) => boolean
}

interface ListCommandService {
  wrapInBulletListCommand: { key: CmdKey<unknown> }
  wrapInOrderedListCommand: { key: CmdKey<unknown> }
}

type ListItemKind = "bullet" | "ordered" | "task"

/**
 * Convert the current selection's list items into `kind`. `wrapIn` cannot
 * retype an existing list (it returns false inside one), so conversions happen
 * via node surgery:
 * - every list item touched by the selection is converted, not just the head
 * - a conversion SPLITS its list: only the covered entries change kind, the
 *   uncovered siblings stay in their own same-kind lists
 * - the converted entries MERGE with immediately adjacent same-kind lists so
 *   `1. a / * b / 1. c` → convert b to numbered → `1. a / 2. b / 3. c`
 * - converting to a task just sets the covered items' `checked` attr; Milkdown
 *   keeps `checked` on the list item and it is valid in both bullet and ordered
 *   lists (`1. [ ] item` is GFM)
 * Outside a list, the block is wrapped into the target list type instead.
 */
function setListItemKind(
  view: EditorView,
  commands: ListCommands,
  service: ListCommandService,
  kind: ListItemKind,
): void {
  const { state, dispatch } = view
  const { $from, $to } = state.selection
  const from = $from.pos
  const to = $to.pos

  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") {
      itemDepth = d
      break
    }
  }

  if (itemDepth === -1) {
    const listKey =
      kind === "ordered"
        ? service.wrapInOrderedListCommand.key
        : service.wrapInBulletListCommand.key
    if (commands.call(listKey) && kind === "task") setTaskChecked(view, false)
    return
  }

  const touched = collectTouchedLists(state, from, to)
  if (touched.length === 0) return
  const tr = state.tr

  if (kind === "task") {
    for (const t of touched) {
      t.node.forEach((child, offset, index) => {
        if (index < t.first || index > t.last) return
        if (child.attrs.checked !== false) {
          tr.setNodeMarkup(t.pos + 1 + offset, undefined, {
            ...child.attrs,
            checked: false,
          })
        }
      })
    }
    if (tr.docChanged) dispatch(tr.scrollIntoView())
    return
  }

  // A neighbor list may only be absorbed into the converted segment when it is
  // fully covered by the selection or not covered at all. Partially covered
  // neighbors split themselves and must not be swallowed, or their uncovered
  // items would be converted by accident. The selection bounds are mapped to
  // the current document each iteration, because earlier (lower) edits shift
  // the positions the neighbors now occupy.
  const outside = (pos: number, size: number, f: number, t: number): boolean => {
    const nend = pos + size
    return nend <= f || pos >= t
  }
  const covered = (pos: number, size: number, f: number, t: number): boolean => {
    const nend = pos + size
    return f <= pos && nend <= t
  }

  const consumed: { start: number; end: number }[] = []
  // Anchor the selection on the first covered item of the lowest converted
  // list so the caret stays inside the converted content. `tr.mapping.map(from)`
  // cannot be used here: `from` sits inside the replaced range, and mapping a
  // position inside a replaced range yields the END of the replacement.
  let cursorPos: number | null = null
  // Keep the caret at the same text offset within the first covered item, so a
  // bullet/ordered conversion behaves like the task path. Tasks only change
  // attributes in place (setNodeMarkup), which leaves the selection untouched;
  // bullet/ordered rebuild the list node, and without re-applying the offset
  // the caret would snap to the start of the item.
  const firstTouched = [...touched].sort((a, b) => a.pos - b.pos)[0]
  let caretOffset = 0
  if (firstTouched) {
    const para = firstTouched.node.child(firstTouched.first).child(0)
    if (para && para.type.name === "paragraph") {
      // `firstOffset` is the covered item's content offset inside the list; its
      // paragraph sits at `pos + firstOffset + 2` (list open, item open).
      // `from` is inside that paragraph, so `from - paraPos` is textOffset + 1
      // (the item's open position), which pairs with the `+ 1` in
      // `replaceListRange`'s `firstCoveredItem`.
      const paraPos = firstTouched.pos + firstTouched.firstOffset + 2
      caretOffset = Math.max(0, Math.min(from - paraPos, para.content.size))
    }
  }
  for (const t of [...touched].sort((a, b) => a.pos - b.pos)) {
    if (consumed.some((r) => t.pos >= r.start && t.pos + t.node.nodeSize <= r.end)) continue
    const curPos = tr.mapping.map(t.pos)
    const curFrom = tr.mapping.map(from)
    const curTo = tr.mapping.map(to)
    const curNode = tr.doc.nodeAt(curPos)
    // A neighbor that an earlier (lower) list absorbed now maps into a
    // list_item inside the merged list; it needs no further work.
    if (!curNode || (curNode.type.name !== "bullet_list" && curNode.type.name !== "ordered_list")) continue
    const result = replaceListRange(tr, state.schema, curNode, curPos, t.first, t.last, kind, {
      mid: (pos, size) => outside(pos, size, curFrom, curTo) || covered(pos, size, curFrom, curTo),
      segment: (pos, size) => outside(pos, size, curFrom, curTo),
    })
    if (cursorPos === null && result) cursorPos = result.firstCoveredItem
    consumed.push({ start: t.pos, end: t.pos + t.node.nodeSize })
  }

  if (tr.docChanged) {
    if (cursorPos !== null) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos + 1 + caretOffset)))
    } else {
      tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(from))))
    }
    dispatch(tr.scrollIntoView())
  }
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
    if (node.type.name !== "bullet_list" && node.type.name !== "ordered_list") return true
    let first = -1
    let last = -1
    let firstOffset = 0
    node.forEach((child, offset, index) => {
      if (child.type.name !== "list_item") return
      // Count an item only when the selection touches its own paragraph, not
      // when it merely reaches a nested list inside the item — that nested
      // list is visited separately below and converted on its own.
      const para = child.child(0)
      if (!para || para.type.name !== "paragraph") return
      const paraStart = pos + 2 + offset
      const paraEnd = paraStart + para.nodeSize
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
    // descend so a nested list is converted on its own (not as part of its
    // parent item's conversion)
    return true
  })
  return touched
}

/**
 * Replace the covered item range `[first, last]` of `listNode` so those items
 * take `kind` and the uncovered siblings keep the original kind, merging with
 * any adjacent list the predicates allow:
 * - `mid` controls merging the converted segment with a same-kind neighbor;
 *   it may absorb neighbors fully outside the selection (the single-point
 *   `1. a / * b / 1. c` case) or fully covered by it (multi-select).
 * - `segment` controls merging an uncovered before/after segment with a
 *   same-kind neighbor; those may only absorb neighbors outside the selection
 *   (a covered neighbor must convert on its own, and it would be skipped by
 *   the consumed-tracking in `setListItemKind`).
 * The merged `mid` may only swallow a `prev`/`next` neighbor when the adjacent
 * before/after segment is empty. Fusing a neighbor into `mid` moves that
 * neighbor's items to the START of `mid`, and placing a non-empty before/after
 * segment in front of them would silently reorder the document
 * (`1. a / 2. b / * x / * y` converting `x` to numbered must not move the
 * bullets above the numbered list). When the neighbor cannot be absorbed, it
 * simply stays in place and `mid` becomes its own fresh list.
 * Returns the position (in the transaction's current document) of the first
 * covered list item, so the caller can restore the caret inside the converted
 * content.
 */
function replaceListRange(
  tr: Transaction,
  schema: Schema,
  listNode: Node,
  listPos: number,
  first: number,
  last: number,
  kind: "bullet" | "ordered",
  allow: { mid: (pos: number, size: number) => boolean; segment: (pos: number, size: number) => boolean },
): { firstCoveredItem: number } | null {
  const isOrdered = listNode.type.name === "ordered_list"
  const origName = listNode.type.name
  const targetName = kind === "ordered" ? "ordered_list" : "bullet_list"
  const order = listNode.attrs.order ?? 1
  const spread = listNode.attrs.spread ?? false
  const setItemAttrs = (node: Node, attrs: Record<string, unknown>) =>
    node.type.create({ ...node.attrs, ...attrs }, node.content, node.marks)

  const itemsOf = (node: Node): Node[] => {
    const items: Node[] = []
    node.forEach((child) => items.push(child))
    return items
  }
  const normalize = (name: string, items: Node[], ord: number): Node | null => {
    if (items.length === 0) return null
    const isOrd = name === "ordered_list"
    return schema.nodes[name].create(
      isOrd ? { order: ord, spread } : { spread },
      items.map((child, index) =>
        setItemAttrs(child, {
          listType: isOrd ? "ordered" : "bullet",
          label: isOrd ? `${index + ord}.` : "•",
        }),
      ),
    )
  }

  const beforeItems: Node[] = []
  const midItems: Node[] = []
  const afterItems: Node[] = []
  listNode.forEach((child, _offset, index) => {
    if (index < first) beforeItems.push(child)
    else if (index > last) afterItems.push(child)
    else midItems.push(child)
  })

  let mid = normalize(
    targetName,
    midItems.map((child) => setItemAttrs(child, { checked: null })),
    order,
  )
  let before = normalize(origName, beforeItems, order)
  let after = normalize(origName, afterItems, order)
  let startPos = listPos
  let endPos = listPos + listNode.nodeSize

  const prev = tr.doc.resolve(listPos).nodeBefore
  const next = tr.doc.resolve(endPos).nodeAfter

  // `mid` may only swallow `prev` when there is no `before` segment: fusing
  // `prev` into `mid` puts `prev`'s items at the start of `mid`, and a
  // non-empty `before` placed in front of them would swap their order.
  let prevAbsorbedSize = 0
  if (mid && !before && prev && prev.type.name === targetName && allow.mid(listPos - prev.nodeSize, prev.nodeSize)) {
    prevAbsorbedSize = prev.content.size
    mid = normalize(targetName, [...itemsOf(prev), ...itemsOf(mid)], prev.attrs.order ?? 1)
    startPos -= prev.nodeSize
  } else if (before && prev && prev.type.name === origName && allow.segment(listPos - prev.nodeSize, prev.nodeSize)) {
    before = normalize(origName, [...itemsOf(prev), ...itemsOf(before)], prev.attrs.order ?? order)
    startPos -= prev.nodeSize
  }

  // Same on the right side: `mid` may only swallow `next` when `after` is empty.
  if (mid && !after && next && next.type.name === targetName && allow.mid(endPos, next.nodeSize)) {
    mid = normalize(targetName, [...itemsOf(mid), ...itemsOf(next)], mid.attrs.order ?? order)
    endPos += next.nodeSize
  } else if (after && next && next.type.name === origName && allow.segment(endPos, next.nodeSize)) {
    after = normalize(origName, [...itemsOf(after), ...itemsOf(next)], order)
    endPos += next.nodeSize
  }

  let firstCoveredItem: number | null = null
  if (mid) {
    // `midStart` is the start of the converted list node itself; its first item
    // (or the first covered one after any absorbed `prev` items) begins one
    // position in, hence the `+ 1`. This is the covered ITEM position; the
    // caret target is itemPos + 1 + caretOffset.
    const midStart = startPos + (before?.nodeSize ?? 0)
    firstCoveredItem = midStart + prevAbsorbedSize + 1
  }

  tr.replaceWith(startPos, endPos, [before, mid, after].filter((n): n is Node => n != null))
  return mid ? { firstCoveredItem: firstCoveredItem! } : null
}

export function initToolbarHandler(getEditor: () => Editor | null) {
  const unsubToolbar = appEvents.on(AppEvent.ToolbarCommandExec, async ({ command, level }) => {
    const editor = getEditor()
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
    await Promise.all([editorContext.load(), commandService.load()])

    if (command === ToolbarCommand.Link) {
      appEvents.emit(AppEvent.LinkDialogRequested)
      return
    }

    editor.action((ctx) => {
      const view = ctx.get(editorContext.editorViewCtx)
      view.focus()
      const commands = ctx.get(editorContext.commandsCtx)

      switch (command) {
        case ToolbarCommand.Bold:
          commands.call(commandService.toggleStrongCommand.key); break
        case ToolbarCommand.Italic:
          commands.call(commandService.toggleEmphasisCommand.key); break
        case ToolbarCommand.Strike:
          commands.call(commandService.toggleStrikethroughCommand.key); break
        case ToolbarCommand.Code:
          commands.call(commandService.toggleInlineCodeCommand.key); break
        case ToolbarCommand.Hr:
          commands.call(commandService.insertHrCommand.key); break
        case ToolbarCommand.Heading:
          commands.call(commandService.wrapInHeadingCommand.key, level); break
        case ToolbarCommand.Indent:
          commands.call(commandService.sinkListItemCommand.key); break
        case ToolbarCommand.Unindent:
          commands.call(commandService.liftListItemCommand.key); break
        case ToolbarCommand.BulletList:
          setListItemKind(view, commands, commandService, "bullet"); break
        case ToolbarCommand.TaskList:
          setListItemKind(view, commands, commandService, "task"); break
        case ToolbarCommand.OrderedList:
          setListItemKind(view, commands, commandService, "ordered"); break
        case ToolbarCommand.MarkTask:
          setTaskChecked(view, true); break
        case ToolbarCommand.UnmarkTask:
          setTaskChecked(view, false); break
      }
    })
  })

  const unsubInsert = appEvents.on(AppEvent.InsertBlockCommand, async ({ command, level }) => {
    const editor = getEditor()
    if (!editor) return

    const { editorContext } = await import("@/services/editor-context")
    const { commandService } = await import("@/services/command-service")
    await Promise.all([editorContext.load(), commandService.load()])

    const { executeInsertCommand } = await import("@/features/insert-command")
    editor.action((ctx) => {
      executeInsertCommand(ctx, command, level, { appendBelow: true })
    })
  })

  return () => {
    unsubToolbar()
    unsubInsert()
  }
}
