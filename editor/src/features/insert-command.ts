/**
 * insert-command — shared block-insert executor.
 *
 * The block-insert commands that the `/` slash menu (SlashView), the desktop
 * block-handle "+", and the mobile FAB "+" all surface. Extraction point for the
 * logic that used to live inside SlashView.execute, so menu items (which have no
 * Milkdown ctx of their own) run the exact same commands as typing "/cmd".
 */

import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx, commandsCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  paragraphSchema,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
} from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import { SlashCommand, ProseNodeType, proseNodeTypeByName } from "@/config/enums";
import { defaultVideoAttrs } from "@/plugins/video";

export interface InsertCommandOptions {
  /**
   * Add the block BELOW the caret's current top-level block (the "+" model)
   * instead of converting the caret's block in place (the "/cmd" model). A
   * fresh empty paragraph is inserted after the current block and the caret
   * moves into it; when the caret already sits in an empty top-level paragraph
   * that step is skipped so it is converted directly.
   */
  appendBelow?: boolean;
}

export function executeInsertCommand(
  ctx: Ctx,
  cmd: SlashCommand,
  level?: number,
  opts?: InsertCommandOptions,
): void {
  const view = ctx.get(editorViewCtx);
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

  // Empty block nested in a list / blockquote / heading → convert that block
  // in place (same special cases the slash menu handles). Kept BEFORE the
  // ThematicBreak check so a divider picked inside an empty list item behaves
  // exactly as it does from the "/" menu.
  if ($from.parent.content.size === 0) {
    let parentType: ProseNodeType | null = null;
    let parentDepth = 0;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (
        node.type === schema.nodes.bullet_list ||
        node.type === schema.nodes.ordered_list ||
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

  const commands = ctx.get(commandsCtx);
  if (cmd === SlashCommand.Heading) commands.call(wrapInHeadingCommand.key, level);
  else if (cmd === SlashCommand.BulletList)
    commands.call(wrapInBulletListCommand.key);
  else if (cmd === SlashCommand.OrderedList)
    commands.call(wrapInOrderedListCommand.key);
  else if (cmd === SlashCommand.Blockquote)
    commands.call(wrapInBlockquoteCommand.key);
  else if (cmd === SlashCommand.TodoList) convertToTodoList(view);
  else if (cmd === SlashCommand.CodeBlock) convertToCodeBlock(view);
  else if (cmd === SlashCommand.MathBlock) convertToMathBlock(view);
  else if (cmd === SlashCommand.Table) insertTable(ctx, view);
  view.focus();
}

// ── Helpers (hoisted from the slash menu; behavior preserved) ──

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
    insertBelow(view, cmd, level);
    return;
  }

  if (parentType === ProseNodeType.BulletList && cmd === SlashCommand.OrderedList) {
    const pos = $from.before(parentDepth);
    const node = $from.node(parentDepth);
    dispatch(
      state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        schema.nodes.ordered_list.create(null, node.content),
      ),
    );
    return;
  }
  if (parentType === ProseNodeType.OrderedList && cmd === SlashCommand.BulletList) {
    const pos = $from.before(parentDepth);
    const node = $from.node(parentDepth);
    dispatch(
      state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        schema.nodes.bullet_list.create(null, node.content),
      ),
    );
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
  const para = schema.nodes.paragraph.create();
  let newBlock: Node;
  if (cmd === SlashCommand.BulletList)
    newBlock = schema.nodes.bullet_list.create(
      null,
      schema.nodes.list_item.create(null, para),
    );
  else if (cmd === SlashCommand.OrderedList)
    newBlock = schema.nodes.ordered_list.create(
      null,
      schema.nodes.list_item.create(null, para),
    );
  else newBlock = schema.nodes.blockquote.create(null, para);
  dispatch(state.tr.replaceWith(pos, pos + block.nodeSize, newBlock));
}

/**
 * Insert the block AFTER the caret's current block (used by the slash menu when
 * a divider is picked inside an empty list/blockquote/heading item). Kept
 * faithful to the original SlashView.insertBelow.
 */
function insertBelow(view: EditorView, cmd: SlashCommand, level: number): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;
  const afterPos = $from.after($from.depth);
  if (cmd === SlashCommand.Heading) {
    const heading = schema.nodes.heading.create({ level });
    const tr = state.tr.insert(afterPos, heading);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 1)));
    return;
  }
  if (cmd === SlashCommand.ThematicBreak) {
    const hr = schema.nodes.hr.create();
    const para = schema.nodes.paragraph.create();
    const tr = state.tr.insert(afterPos, hr).insert(afterPos + 2, para);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 3)));
    return;
  }
  const para = schema.nodes.paragraph.create();
  let newBlock: Node;
  if (cmd === SlashCommand.BulletList)
    newBlock = schema.nodes.bullet_list.create(
      null,
      schema.nodes.list_item.create(null, para),
    );
  else if (cmd === SlashCommand.OrderedList)
    newBlock = schema.nodes.ordered_list.create(
      null,
      schema.nodes.list_item.create(null, para),
    );
  else newBlock = schema.nodes.blockquote.create(null, para);
  const tr = state.tr.insert(afterPos, newBlock);
  const selPos = cmd === SlashCommand.Blockquote ? afterPos + 2 : afterPos + 3;
  dispatch(tr.setSelection(TextSelection.create(tr.doc, selPos)));
}

function insertDivider(view: EditorView): void {
  const { state, dispatch } = view;
  const { schema } = state;
  const { $from } = state.selection;

  const pos = $from.before($from.depth);
  const blockSize = $from.node($from.depth).nodeSize;
  const hr = schema.nodes.hr.create();
  const para = schema.nodes.paragraph.create();
  const tr = state.tr.replaceWith(pos, pos + blockSize, [hr, para]);
  dispatch(
    tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView(),
  );
}

function convertToTodoList(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const para = state.schema.nodes.paragraph.create();
  const listItem = state.schema.nodes.list_item.create(
    { checked: false },
    para,
  );
  const bulletList = state.schema.nodes.bullet_list.create(null, listItem);
  const pos = $from.before($from.depth);
  dispatch(
    state.tr
      .replaceWith(pos, pos + $from.node($from.depth).nodeSize, bulletList)
      .scrollIntoView(),
  );
}

function convertToCodeBlock(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const codeBlock = state.schema.nodes.code_block.create({ language: "" });
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
  const codeBlock = state.schema.nodes.code_block.create({
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

function insertTable(ctx: Ctx, view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const pos = $from.before($from.depth);
  const tbl = createTable(ctx, 3, 3);
  dispatch(
    state.tr
      .replaceWith(pos, pos + $from.node($from.depth).nodeSize, tbl)
      .scrollIntoView(),
  );
}

/**
 * Replace the caret's current block with an empty image block + paragraph, then
 * dispatch the same `inb4doc:edit-image` event the editor emits on image
 * double-click so the existing SlashView picker opens for URL/upload.
 */
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
  view.dom.dispatchEvent(
    new CustomEvent("inb4doc:edit-image", {
      bubbles: true,
      detail: { pos, src: "" },
    }),
  );
}

/**
 * Replace the caret's current block with an empty video node + paragraph, then
 * dispatch the same `inb4doc:edit-video` event the video node emits on click so
 * the existing video dialog opens.
 */
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
