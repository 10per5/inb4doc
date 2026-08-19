/**
 * insert-command — shared block-insert executor.
 *
 * The block-insert commands that the `/` slash menu (SlashView), the desktop
 * block-handle "+", and the mobile FAB "+" all surface. Extraction point for the
 * logic that used to live inside SlashView.execute, so menu items (which have no
 * Milkdown ctx of their own) run the exact same commands as typing "/cmd".
 */

import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { wrapIn, setBlockType } from "prosemirror-commands"
import { wrapInList } from "prosemirror-schema-list"

type PMCommand = (state: any, dispatch?: (tr: any) => void) => boolean
import { SlashCommand, ProseNodeType, proseNodeTypeByName } from "@/config/enums";
import { defaultVideoAttrs } from "@/plugins/video";
import { setListItemKind } from "@/utils/editor-mutator";
import { openImageDialog } from "@/controllers/dialog/image-dialog.type";

export interface InsertCommandOptions {
  appendBelow?: boolean;
}

export function executeInsertCommand(
  view: EditorView,
  cmd: SlashCommand,
  level?: number,
  opts?: InsertCommandOptions,
): void {
  view.focus();
  let { state } = view;
  let { $from } = state.selection;
  const { schema } = state;

  if (opts?.appendBelow) {
    const inEmptyTopParagraph =
      $from.depth === 1 &&
      $from.parent.type === schema.nodes.paragraph &&
      $from.parent.content.size === 0;
    if (!inEmptyTopParagraph) {
      const afterPos = $from.depth === 0 ? $from.pos : $from.after(1);
      const tr = state.tr.insert(afterPos, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos + 1)));
      view.dispatch(tr);
      state = view.state;
      $from = state.selection.$from;
    }
  }

  if (cmd === SlashCommand.Image) {
    insertImageBlock(view);
    return;
  }
  if (cmd === SlashCommand.Video) {
    insertVideoBlock(view);
    return;
  }

  const dispatch = (tr: import("prosemirror-state").Transaction) => view.dispatch(tr);
  const listCommands: { call(key: string | PMCommand, ...args: unknown[]): boolean } = {
    call(key: string, ..._args: unknown[]) {
      if (key === "bullet") return wrapInList(schema.nodes.list)(view.state, dispatch);
      if (key === "ordered") return wrapInList(schema.nodes.list)(view.state, dispatch);
      return false;
    },
  };
  const listService = {
    wrapInBulletListCommand: wrapInList(schema.nodes.list) as PMCommand,
    wrapInOrderedListCommand: wrapInList(schema.nodes.list) as PMCommand,
  };

  if (cmd === SlashCommand.BulletList) {
    setListItemKind(view, listCommands, listService, "bullet");
    view.focus();
    return;
  }
  if (cmd === SlashCommand.OrderedList) {
    setListItemKind(view, listCommands, listService, "ordered");
    view.focus();
    return;
  }
  if (cmd === SlashCommand.TodoList) {
    setListItemKind(view, listCommands, listService, "task");
    view.focus();
    return;
  }

  if ($from.parent.content.size === 0) {
    let parentType: ProseNodeType | null = null;
    let parentDepth = 0;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (
        node.type === schema.nodes.list ||
        node.type === schema.nodes.list ||
        node.type === schema.nodes.blockquote
      ) {
        parentType = proseNodeTypeByName.get(node.type.name) ?? null;
        parentDepth = d;
        break;
      }
    }
    const isHeading = $from.parent.type === schema.nodes.heading;
    if (parentType || isHeading) {
      replaceBlock(view, cmd, level ?? 1, parentType, parentDepth, isHeading);
      return;
    }
  }

  if (cmd === SlashCommand.ThematicBreak) {
    insertDivider(view);
    return;
  }

  if (cmd === SlashCommand.Heading) {
    setBlockType(schema.nodes.heading, { level })(view.state, (tr) => view.dispatch(tr));
  } else if (cmd === SlashCommand.Blockquote) {
    wrapIn(schema.nodes.blockquote)(view.state, (tr) => view.dispatch(tr));
  } else if (cmd === SlashCommand.CodeBlock) convertToCodeBlock(view);
  else if (cmd === SlashCommand.MathBlock) convertToMathBlock(view);
  else if (cmd === SlashCommand.Table) insertTable(view);
  view.focus();
}

// ── Helpers ──

function replaceBlock(
  view: EditorView,
  cmd: SlashCommand,
  level: number,
  parentType: ProseNodeType | null,
  parentDepth: number,
  isHeading: boolean,
): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;

  if (cmd === SlashCommand.ThematicBreak) {
    insertBelow(view);
    return;
  }

  if (parentType === ProseNodeType.Blockquote && cmd === SlashCommand.Blockquote) return;

  if (cmd === SlashCommand.Heading) {
    const heading = schema.nodes.heading.create({ level });
    const pos = parentType
      ? $from.before(parentDepth)
      : $from.before($from.depth);
    dispatch(
      state.tr.replaceWith(
        pos,
        pos +
          (parentType ? $from.node(parentDepth) : $from.node($from.depth))
            .nodeSize,
        heading,
      ),
    );
    return;
  }

  const pos =
    isHeading || parentType
      ? $from.before(parentType ? parentDepth : $from.depth)
      : $from.before($from.depth);
  const block = parentType
    ? $from.node(parentType ? parentDepth : $from.depth)
    : $from.node($from.depth);
  const newBlock = schema.nodes.blockquote.create(
    null,
    schema.nodes.paragraph.create(),
  );
  dispatch(state.tr.replaceWith(pos, pos + block.nodeSize, newBlock));
}

function insertBelow(view: EditorView): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;
  const afterPos = $from.after($from.depth);
  const hr = schema.nodes.horizontalRule.create();
  const para = schema.nodes.paragraph.create();
  const tr = state.tr.insert(afterPos, hr).insert(afterPos + 2, para);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 3)));
}

function insertDivider(view: EditorView): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;

  const pos = $from.before($from.depth);
  const blockSize = $from.node($from.depth).nodeSize;
  const hr = schema.nodes.horizontalRule.create();
  const para = schema.nodes.paragraph.create();
  const tr = state.tr.replaceWith(pos, pos + blockSize, [hr, para]);
  dispatch(
    tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView(),
  );
}

function convertToCodeBlock(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const codeBlock = state.schema.nodes.codeBlock.create({ language: "" });
  const pos = $from.before($from.depth);
  const tr = state.tr.replaceWith(
    pos,
    pos + $from.node($from.depth).nodeSize,
    codeBlock,
  );
  dispatch(
    tr
      .setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
      .scrollIntoView(),
  );
}

function convertToMathBlock(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const codeBlock = state.schema.nodes.codeBlock.create({
    language: "LaTeX",
  });
  const pos = $from.before($from.depth);
  const tr = state.tr.replaceWith(
    pos,
    pos + $from.node($from.depth).nodeSize,
    codeBlock,
  );
  dispatch(
    tr
      .setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
      .scrollIntoView(),
  );
}

function insertTable(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const pos = $from.before($from.depth);
  const { schema } = state;
  const tableNode = schema.nodes.table;
  const tableRow = schema.nodes.tableRow;
  const tableCell = schema.nodes.tableCell;
  const tableHeader = schema.nodes.tableHeaderCell;
  const para = schema.nodes.paragraph;
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const cells = [];
    for (let c = 0; c < 3; c++) {
      const cellType = r === 0 ? tableHeader : tableCell;
      cells.push(cellType.create(null, para.create()));
    }
    rows.push(tableRow.create(null, ...cells));
  }
  const tbl = tableNode.create(null, ...rows);
  dispatch(
    state.tr
      .replaceWith(pos, pos + $from.node($from.depth).nodeSize, tbl)
      .scrollIntoView(),
  );
}

function insertImageBlock(view: EditorView): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;
  const img = schema.nodes["image-block"]?.create({
    src: "",
    caption: "",
    ratio: 1,
  });
  if (!img) return;
  const para = schema.nodes.paragraph.create();
  const pos = $from.before($from.depth);
  const blockSize = $from.node($from.depth).nodeSize;
  const tr = state.tr.replaceWith(pos, pos + blockSize, [img, para]);
  tr.setSelection(TextSelection.create(tr.doc, pos + img.nodeSize + 1));
  dispatch(tr.scrollIntoView());
  openImageDialog({
    mode: "create",
    pos,
    src: "",
    attrs: { ...img.attrs },
  }).then((result) => {
    if (result == null || result.action !== "save") return;
    const { state: s, dispatch: d } = view;
    const node = s.doc.nodeAt(pos);
    if (!node) return;
    d(
      s.tr.setNodeMarkup(pos, null, {
        ...(node.attrs as Record<string, unknown>),
        src: result.src,
        caption: result.caption,
      }),
    );
    view.focus();
  });
}

function insertVideoBlock(view: EditorView): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;
  const video = schema.nodes.video?.create(defaultVideoAttrs);
  if (!video) return;
  const para = schema.nodes.paragraph.create();
  const pos = $from.before($from.depth);
  const blockSize = $from.node($from.depth).nodeSize;
  const tr = state.tr.replaceWith(pos, pos + blockSize, [video, para]);
  tr.setSelection(TextSelection.create(tr.doc, pos + video.nodeSize + 1));
  dispatch(tr.scrollIntoView());
  view.dom.dispatchEvent(
    new CustomEvent("inb4doc:edit-video", {
      bubbles: true,
      detail: { pos, attrs: { ...defaultVideoAttrs } },
    }),
  );
}
