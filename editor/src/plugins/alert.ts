import { $remark, $nodeSchema } from "@milkdown/utils";
import type { Root } from "@milkdown/transformer";

const ALERT_TYPES = ["note", "tip", "important", "warning", "caution", "info", "success", "danger"];

const alertMatchRegex = /^\[!([A-Z]+)\]\s*/i;

function walkAlerts(tree: Root) {
  const children = tree.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "blockquote") continue;
    const firstChild = (node as any).children?.[0];
    if (!firstChild || firstChild.type !== "paragraph") continue;
    const firstText = firstChild.children?.[0];
    if (!firstText || firstText.type !== "text") continue;
    const match = firstText.value.match(alertMatchRegex);
    if (!match) continue;
    const type = match[1].toLowerCase();
    if (!ALERT_TYPES.includes(type)) continue;
    firstText.value = firstText.value.slice(match[0].length);
    if (firstText.value === "") {
      firstChild.children.shift();
      if (firstChild.children.length === 0) {
        (node as any).children.shift();
      }
    }
    children[i] = {
      type: "alert",
      dataType: type,
      children: (node as any).children,
    } as any;
  }
}

export const alertRemarkPlugin = $remark("alert-remark", () => {
  return () => (tree: Root) => {
    walkAlerts(tree);
  };
});

export const alertSchema = $nodeSchema("alert", () => ({
  group: "block",
  content: "block+",
  defining: true,
  attrs: { type: { default: "note" } },
  parseDOM: [
    {
      tag: "blockquote.book-hint",
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        for (const t of ALERT_TYPES) {
          if (el.classList.contains(t)) return { type: t };
        }
        return { type: "note" };
      },
    },
  ],
  toDOM: (node) => [
    "blockquote",
    { class: `book-hint ${node.attrs.type}` },
    0,
  ],
  parseMarkdown: {
    match: ({ type, dataType }) => type === "alert" && !!dataType,
    runner: (state, node, proseType) => {
      state.openNode(proseType, { type: node.dataType || "note" });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "alert",
    runner: (state, node) => {
      state.openNode("blockquote");
      const content = node.content;
      const children: any[] = [];
      content.forEach((child) => children.push(child));

      if (children.length > 0) {
        const firstPara = children[0];
        state.openNode("paragraph");
        state.addNode("text", undefined, `[!${node.attrs.type}] `);
        state.next(firstPara.content);
        state.closeNode();
        for (let i = 1; i < children.length; i++) {
          state.next(children[i]);
        }
      }
      state.closeNode();
    },
  },
}));
