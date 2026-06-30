import {
  $nodeSchema,
  $remark,
  $inputRule,
  $command,
} from "@milkdown/kit/utils";
import { nodeRule } from "@milkdown/kit/prose";
import { textblockTypeInputRule } from "@milkdown/kit/prose/inputrules";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { findNodeInSelection } from "@milkdown/kit/prose";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import type { Node } from "@milkdown/kit/prose/model";
import type { Plugin } from "@milkdown/kit/prose/state";
import katex from "katex";

const mathInlineId = "math_inline";

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

export const remarkMathPlugin = $remark("remarkMath", () => remarkMath);

export const remarkMathBlockPlugin = $remark("remarkMathBlock", () => {
  return () => (tree: any) => {
    (visit as any)(tree, "math", (node: any, index: number, parent: any) => {
      if (parent && typeof index === "number") {
        parent.children.splice(index, 1, {
          type: "code",
          lang: "LaTeX",
          value: node.value,
        });
      }
    });
  };
});

export const mathInlineSchema = $nodeSchema(mathInlineId, () => ({
  group: "inline",
  inline: true,
  draggable: true,
  atom: true,
  attrs: {
    value: { default: "" },
  },
  parseDOM: [
    {
      tag: `span[data-type="${mathInlineId}"]`,
      getAttrs: (dom) => ({
        value: (dom as HTMLElement).dataset.value ?? "",
      }),
    },
  ],
  toDOM: (node) => {
    const code: string = node.attrs.value;
    const dom = document.createElement("span");
    dom.dataset.type = mathInlineId;
    dom.dataset.value = code;
    katex.render(code, dom, { throwOnError: false });
    return dom;
  },
  parseMarkdown: {
    match: (astNode) => astNode.type === "inlineMath",
    runner: (state, astNode, proseType) => {
      state.addNode(proseType, { value: astNode.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === mathInlineId,
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.attrs.value);
    },
  },
}));

export const blockLatexSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const baseSchema = prev(ctx);
    return {
      ...baseSchema,
      toMarkdown: {
        match: baseSchema.toMarkdown.match,
        runner: (state, node) => {
          const language = node.attrs.language ?? "";
          if (language.toLowerCase() === "latex") {
            state.addNode(
              "math",
              undefined,
              node.content.firstChild?.text || "",
            );
          } else {
            return baseSchema.toMarkdown.runner(state, node);
          }
        },
      },
    };
  };
});

export const mathInlineInputRule = $inputRule((ctx) =>
  nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
    getAttr: (match) => ({ value: match[1] ?? "" }),
  }),
);

export const mathBlockInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^\$\$[\s\n]$/, codeBlockSchema.type(ctx), () => ({
    language: "LaTeX",
  })),
);

export const toggleLatexCommand = $command("ToggleLatex", (ctx) => {
  return () => (state, dispatch) => {
    const { hasNode: hasLatex, pos: latexPos, target: latexNode } =
      findNodeInSelection(state, mathInlineSchema.type(ctx));

    const { selection, doc, tr } = state;
    if (!hasLatex) {
      const text = doc.textBetween(selection.from, selection.to);
      const _tr = tr.replaceSelectionWith(
        mathInlineSchema.type(ctx).create({ value: text }),
      );
      if (dispatch) {
        dispatch(
          _tr.setSelection(NodeSelection.create(_tr.doc, selection.from)),
        );
      }
      return true;
    }

    const { from, to } = selection;
    if (!latexNode || latexPos < 0) return false;

    let _tr = tr.delete(latexPos, latexPos + 1);
    const content = (latexNode as Node).attrs.value;
    _tr = _tr.insertText(content, latexPos);
    if (dispatch) {
      dispatch(
        _tr.setSelection(
          TextSelection.create(_tr.doc, from, to + content.length - 1),
        ),
      );
    }
    return true;
  };
});
