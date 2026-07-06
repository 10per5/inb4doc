import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

const SHORTCODE_RE = /\{\{(<|%)\s*(\/?)\s*(\w+(?:\.\w+)?)((?:\s+(?:"[^"]*"|\[[^\]]*\]|\S+))*)\s*[>%]\}\}/g;

function shortcodeClass(full: string): string {
  const m = SHORTCODE_RE.exec(full);
  SHORTCODE_RE.lastIndex = 0;
  if (!m) return "shortcode-tag";
  const delim = m[1];
  const name = m[3];
  let cls = "shortcode-tag";
  if (name === "param") cls += " shortcode-param";
  else if (name === "details") cls += " shortcode-detail-tag";
  if (delim === "%") cls += " shortcode-percent";
  return cls;
}

function addDeco(decos: Decoration[], from: number, to: number, cls: string) {
  if (to <= from) return;
  decos.push(Decoration.inline(from, to, { class: cls }));
}

export const shortcodeDecoration = $prose(() => {
  const key = new PluginKey("inb4doc-shortcode-deco");

  return new Plugin({
    key,
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        const doc = state.doc;
        const spans: { from: number; to: number; name: string; closing: boolean }[] = [];

        doc.descendants((node, pos) => {
          if (!node.isText) return;
          const text = node.text || "";
          let match: RegExpExecArray | null;
          const re = /\{\{(<|%)\s*(\/?)\s*(\w+(?:\.\w+)?)((?:\s+(?:"[^"]*"|\[[^\]]*\]|\S+))*)\s*[>%]\}\}/g;
          while ((match = re.exec(text)) !== null) {
            const full = match[0];
            const from = pos + match.index;
            const to = pos + match.index + full.length;
            const name = match[3];
            const closing = !!match[2];
            const cls = shortcodeClass(full);
            addDeco(decos, from, to, cls);
            spans.push({ from, to, name, closing });
          }
        });

        const openings: { to: number; name: string }[] = [];
        for (const span of spans) {
          if (!span.closing) {
            openings.push({ to: span.to, name: span.name });
          } else {
            for (let i = openings.length - 1; i >= 0; i--) {
              if (openings[i].name === span.name) {
                addDeco(decos, openings[i].to, span.from, "shortcode-body");
                openings.splice(i, 1);
                break;
              }
            }
          }
        }

        return DecorationSet.create(doc, decos);
      },
    },
  });
});
