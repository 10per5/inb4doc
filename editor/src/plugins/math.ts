import type { Node, NodeType } from "prosemirror-model"
import { InputRule, inputRules } from "prosemirror-inputrules"
import { NodeSelection, TextSelection } from "prosemirror-state"
import katex from "katex"

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

export const mathInlineInputRule = inputRules({
  rules: [
    new InputRule(
      /(?:\$)([^$]+)(?:\$)$/,
      (state, match, start, end) => {
        const nodeType: NodeType | undefined = state.schema.nodes.math_inline;
        if (!nodeType) return null;
        const value = match[1] ?? "";
        const tr = state.tr;
        tr.replaceWith(start, end, nodeType.create({ value }));
        return tr;
      }
    )
  ]
});

export const mathBlockInputRule = inputRules({
  rules: [
    new InputRule(
      /^\$\$[\s\n]$/,
      (state, _match, start, _end) => {
        const nodeType: NodeType | undefined = state.schema.nodes.code_block;
        if (!nodeType) return null;
        const tr = state.tr;
        tr.delete(start - 1, start + 1);
        tr.setBlockType(start, start, nodeType, { language: "LaTeX" });
        return tr;
      }
    )
  ]
});

export function toggleLatexCommand(
  state: any,
  dispatch: ((tr: any) => void) | undefined
): boolean {
  const mathInlineType: NodeType | undefined = state.schema.nodes.math_inline;
  if (!mathInlineType) return false;

  const { $from } = state.selection;
  const nodeBefore = $from.nodeBefore;

  if (nodeBefore && nodeBefore.type === mathInlineType) {
    const pos = $from.pos - nodeBefore.nodeSize;
    if (dispatch) {
      let tr = state.tr.delete(pos, pos + nodeBefore.nodeSize);
      const content = nodeBefore.attrs.value as string;
      tr = tr.insertText(content, pos);
      dispatch(tr);
    }
    return true;
  }

  const { selection, doc, tr } = state;
  const text = doc.textBetween(selection.from, selection.to);
  if (dispatch) {
    const _tr = tr.replaceSelectionWith(
      mathInlineType.create({ value: text })
    );
    dispatch(
      _tr.setSelection(
        NodeSelection.create(_tr.doc, selection.from)
      )
    );
  }
  return true;
}
