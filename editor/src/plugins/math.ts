import { defineNodeView, union } from "@prosekit/core";
import {
  defineMathBlockEnterRule,
  defineMathBlockSpec,
  defineMathInline,
  defineMathPlugin,
} from "@prosekit/extensions/math";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import katex from "katex";

export function renderLatex(content: string, displayMode = false) {
  try {
    return katex.renderToString(content, {
      throwOnError: false,
      displayMode,
    });
  } catch {
    return content;
  }
}

/**
 * Official prosekit math extension pieces: the `mathBlock`/`mathInline`
 * node specs, their input rules (`$...$` inline, `$$` + Enter on an empty
 * line for a block) and the cursor plugin. The stock block VIEW is omitted
 * — it toggles source-vs-rendered, but we want both at once, so
 * `mathBlockPreviewView` below is the sole mathBlock view.
 */
export function createMathExtension() {
  return union(
    defineMathBlockSpec(),
    defineMathInline({
      render(text: string, element: HTMLElement) {
        element.innerHTML = renderLatex(text, false);
      },
    }),
    defineMathBlockEnterRule(),
    defineMathPlugin(),
  );
}

/** Toggle the selection / word into an inline math node, or unwrap it. */
export const toggleMathInlineCommand: Command = (state, dispatch) => {
  const mathInlineType = state.schema.nodes.mathInline;
  if (!mathInlineType) return false;

  const { $from } = state.selection;
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore && nodeBefore.type === mathInlineType) {
    const pos = $from.pos - nodeBefore.nodeSize;
    if (dispatch) {
      let tr = state.tr.delete(pos, pos + nodeBefore.nodeSize);
      tr = tr.insertText(nodeBefore.textContent, pos);
      dispatch(tr);
    }
    return true;
  }

  const { selection } = state;
  const text = state.doc.textBetween(selection.from, selection.to);
  if (dispatch) {
    const node = mathInlineType.create(
      null,
      text ? [state.schema.text(text)] : undefined,
    );
    const tr = state.tr.replaceSelectionWith(node);
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(selection.from + node.nodeSize)),
    );
    dispatch(tr);
  }
  return true;
};

// ---- mathBlock node view with persistent live preview ----
//
// The stock prosemirror-math block view shows EITHER the TeX source (cursor
// inside) OR the rendered math (cursor outside). We want both at once —
// editable source on top, KaTeX preview below that re-renders on every
// keystroke — so we override the view while keeping the official spec and
// input rules. Chrome/preview events are kept away from ProseMirror with the
// same stopEvent/ignoreMutation pattern as the code-block node view.

class MathBlockPreviewView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: Node;
  private preview: HTMLElement;
  private lastRendered: string | null = null;

  constructor(node: Node) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "math-block-wrapper";

    this.contentDOM = document.createElement("pre");
    this.contentDOM.className = "math-block-src";
    this.contentDOM.spellcheck = false;

    this.preview = document.createElement("div");
    this.preview.className = "math-block-preview";
    this.preview.setAttribute("contenteditable", "false");

    this.dom.appendChild(this.contentDOM);
    this.dom.appendChild(this.preview);

    this.renderPreview();
  }

  private renderPreview() {
    const text = this.node.textContent;
    if (text === this.lastRendered) return;
    this.lastRendered = text;
    this.preview.innerHTML = renderLatex(text, true);
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderPreview();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Element | null;
    return !(target && this.contentDOM.contains(target));
  }

  ignoreMutation(mutation: {
    type: string;
    target: EventTarget | null;
  }): boolean {
    const target = mutation.target as Element | null;
    return !target || !this.contentDOM.contains(target);
  }

  destroy() {}
}

/**
 * Registered after `defineMath()` so it overrides the stock mathBlock view.
 */
export const mathBlockPreviewView = defineNodeView({
  name: "mathBlock",
  constructor: (node) => new MathBlockPreviewView(node),
});
