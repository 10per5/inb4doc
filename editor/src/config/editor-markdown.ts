import type { Node as ProseNode, Schema } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
} from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
// @ts-expect-error no types
import taskLists from "markdown-it-task-lists";

import { ALERT_TYPES } from "./editor-schema";

/**
 * Markdown <-> ProseKit bridge.
 *
 * Parsing uses markdown-it (native GFM tables + strikethrough, linkify
 * autolinks, markdown-it-task-lists) via prosemirror-markdown's token
 * handlers, plus a post-parse doc fixup that rebuilds the app's custom
 * nodes (video, div-center, alert, hugoRef, math, image-block, task
 * checkboxes). Serialization uses a MarkdownSerializer covering the same
 * custom nodes so the markdown corpus round-trips.
 */

type ParseState = {
  schema: Schema;
  parse(text: string): ProseNode;
  serialize(doc: ProseNode): string;
};

// --- markdown-it tokens -----------------------------------------------------

function listIsTight(tokens: any[], i: number): boolean {
  while (++i < tokens.length)
    if (tokens[i].type !== "list_item_open") return tokens[i].hidden;
  return false;
}

function alignmentOf(tok: any): string {
  const style: string = tok.attrGet("style") || "";
  const m = style.match(/text-align:\s*(left|center|right)/);
  return m ? m[1] : "left";
}

/** `$...$` inline math tokenizer (mirrors remark-math's inline rule). */
function mathInlineRule(md: MarkdownIt) {
  md.inline.ruler.before("text", "math_inline", (state: any, silent: boolean) => {
    const pos = state.pos;
    const src = state.src;
    if (src.charCodeAt(pos) !== 0x24) return false;
    if (src.charCodeAt(pos + 1) === 0x24) return false;
    const next = src.indexOf("$", pos + 1);
    if (next === -1 || next === pos + 1) return false;
    const content = src.slice(pos + 1, next);
    if (/^\s|\s$/.test(content)) return false;
    if (/\d/.test(src[next + 1] ?? "")) return false;
    if (!silent) {
      state.pos = pos + 1;
      state.posMax = next;
      state.push("math_inline", "math", 0).content = content;
      state.pos = next + 1;
    } else {
      state.pos = pos + 1;
    }
    return true;
  });
}

function noOp() {}

// --- parser -----------------------------------------------------------------

export function createMarkdownParser(schema: Schema): MarkdownParser {
  const md = MarkdownIt("default", { html: true, linkify: true });
  md.use(taskLists);
  mathInlineRule(md);

  const tokens: Record<string, any> = {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },

    // Lists: markdown-it emits bullet_list/ordered_list + list_item_open/close.
    // ProseKit uses a single 'list' node with kind attr; children are direct
    // blocks (no list_item wrapper). list_item tokens are handled by
    // prosemirror-markdown automatically when block spec is set.
    list_item: { block: "list" },
    bullet_list: {
      block: "list",
      getAttrs: (_: any, tokens: any, i: any) => ({
        kind: "bullet",
      }),
    },
    ordered_list: {
      block: "list",
      getAttrs: (tok: any, tokens: any, i: any) => ({
        kind: "ordered",
        order: +tok.attrGet("start") || 1,
      }),
    },

    heading: {
      block: "heading",
      getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }),
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok: any) => ({ language: tok.info || "" }),
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    image: {
      node: "image",
      getAttrs: (tok: any) => ({
        src: tok.attrGet("src") || "",
        title: tok.attrGet("title") || "",
        alt:
          (tok.children && tok.children[0] && tok.children[0].content) || "",
      }),
    },
    hardbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    link: {
      mark: "link",
      getAttrs: (tok: any) => ({
        href: tok.attrGet("href") || "",
        title: tok.attrGet("title") || null,
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
    math_inline: {
      node: "math_inline",
      getAttrs: (tok: any) => ({ value: tok.content }),
    },

    // Raw HTML -> `html` atom node (inline); block-level html tokens get
    // wrapped in a paragraph so the inline atom can be placed.
    html_inline: {
      node: "html",
      getAttrs: (tok: any) => ({ value: tok.content }),
    },
    html_block: {
      block: "paragraph",
      noCloseToken: true,
      getAttrs: () => ({}),
    },

    // GFM tables (markdown-it native).
    // prosemirror-markdown's tokenHandlers only accepts spec objects, not raw
    // functions. We register all table tokens as ignored here, then override
    // the handlers post-construction with the actual open/close logic.
    table: { ignore: true },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { ignore: true },
    th: { ignore: true },
    td: { ignore: true },
  };

  const parser = new MarkdownParser(schema, md, tokens);

  // Override table token handlers (prosekit-markdown doesn't support raw
  // function specs, but the handler map is a plain object we can patch).
  const TH = schema.nodes.tableHeaderCell;
  const TD = schema.nodes.tableCell;
  const TR = schema.nodes.tableRow;
  const TB = schema.nodes.table;

  const handlers = (parser as any).tokenHandlers;
  Object.assign(handlers, {
    table_open(state: any) {
      state.openNode(TB);
    },
    table_close(state: any) {
      state.closeNode();
    },
    thead_open: noOp,
    thead_close: noOp,
    tbody_open: noOp,
    tbody_close: noOp,
    tr_open(state: any) {
      if (state.top().type.name === "table") {
        state.openNode(TR);
      }
    },
    tr_close(state: any) {
      const top = state.top();
      if (top.type.name === "tableRow") state.closeNode();
    },
    th_open(state: any, tok: any) {
      state.openNode(TH, { alignment: alignmentOf(tok) });
      state.openNode(schema.nodes.paragraph);
    },
    th_close(state: any) {
      state.closeNode();
      state.closeNode();
    },
    td_open(state: any, tok: any) {
      state.openNode(TD, { alignment: alignmentOf(tok) });
      state.openNode(schema.nodes.paragraph);
    },
    td_close(state: any) {
      state.closeNode();
      state.closeNode();
    },
  });

  return parser;
}

// --- post-parse doc fixup ---------------------------------------------------

const DIV_CENTER_OPEN = /^<div\s+align\s*=\s*"center"\s*>/i;
const BR_ONLY = /^<\s*br\s*\/?\s*>$/i;
const TASK_CHECKBOX =
  /<input\b[^>]*class\s*=\s*"[^"]*task-list-item-checkbox[^"]*"[^>]*>/i;
const REF_LINK = /^\{\{%\s*ref\s/;
const REF_PATH = /ref\s+path="([^"]+)"/;

export function parseVideoAttrs(html: string): Record<string, unknown> {
  const trimmed = html.trim();
  const openingTag = trimmed.match(/<video\s[^>]*>/)?.[0] || "";
  const srcVideo = openingTag.match(/src\s*=\s*"([^"]+)"/)?.[1] || "";
  const srcSource =
    trimmed.match(/<source\s[^>]*src\s*=\s*"([^"]+)"/)?.[1] || "";
  const getBool = (attr: string, def: boolean): boolean => {
    const re = new RegExp(`${attr}\\s*=\\s*"(true|false)"`, "i");
    const m = openingTag.match(re);
    if (m) return m[1] === "true";
    return new RegExp(`\\b${attr}\\b`, "i").test(openingTag) || def;
  };
  return {
    src: srcSource || srcVideo,
    poster: openingTag.match(/poster\s*=\s*"([^"]+)"/)?.[1] || "",
    controls: getBool("controls", true),
    loop: getBool("loop", false),
    muted: getBool("muted", false),
    autoplay: getBool("autoplay", false),
    playsinline: getBool("playsinline", false),
    width: openingTag.match(/width\s*=\s*"([^"]+)"/)?.[1] || "",
    height: openingTag.match(/height\s*=\s*"([^"]+)"/)?.[1] || "",
  };
}

export function parseAlt(
  alt: string | undefined | null,
): { ratio: number; w: number; h: number } {
  const parts = String(alt ?? "").split(";");
  let ratio = Number(parts[0] || 1);
  if (Number.isNaN(ratio) || ratio === 0) ratio = 1;
  let w = 0;
  let h = 0;
  for (const p of parts.slice(1)) {
    if (p.startsWith("w=")) {
      const n = Number(p.slice(2));
      if (!Number.isNaN(n) && n > 0) w = n;
    } else if (p.startsWith("h=")) {
      const n = Number(p.slice(2));
      if (!Number.isNaN(n) && n > 0) h = n;
    }
  }
  return { ratio, w, h };
}

/** Rebuild inline children, applying task-checkbox and hugoRef fixups. */
function fixInline(schema: Schema, node: ProseNode): ProseNode[] | null {
  const out: ProseNode[] = [];
  let changed = false;
  node.content.forEach((child, _o, i) => {
    if (child.isText && child.marks.length > 0) {
      const link = child.marks.find((m) => m.type.name === "link");
      if (link && REF_LINK.test(link.attrs.href || "")) {
        const pathMatch = (link.attrs.href || "").match(REF_PATH);
        out.push(
          schema.nodes.hugoRef.create({
            path: pathMatch ? pathMatch[1] : link.attrs.href,
            title: child.text || "",
          }),
        );
        changed = true;
        return;
      }
    }
    if (child.type.name === "html" && TASK_CHECKBOX.test(child.attrs.value)) {
      changed = true;
      return;
    }
    if (child.isText && child.text!.trim() === "" && i === 0) {
      out.push(child);
      return;
    }
    out.push(child);
  });
  return changed ? out : null;
}

/** Returns true when the node is a paragraph wrapping a single html atom. */
function htmlInParagraph(node: ProseNode): string | null {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return null;
  const only = node.firstChild;
  if (!only || only.type.name !== "html") return null;
  return only.attrs.value;
}

/**
 * Detect task list items in a `list` node: look for `<input>` checkbox in
 * the first child paragraph and set kind/checked attrs accordingly.
 *
 * In ProseKit's flat-list model, list children are direct blocks (no
 * list_item wrapper). Task detection happens on the first block child.
 */
function fixTaskListItems(schema: Schema, node: ProseNode): ProseNode | null {
  if (node.type.name !== "list") return null;
  const first = node.firstChild;
  if (!first || first.type.name !== "paragraph") return null;

  const fixed = fixInline(schema, first);
  if (!fixed) return null;

  const checked = (() => {
    for (let i = 0; i < first.content.size; i++) {
      const c = first.child(i);
      if (c.type.name === "html" && TASK_CHECKBOX.test(c.attrs.value)) {
        return /checked/.test(c.attrs.value);
      }
    }
    return null;
  })();

  if (checked === null) return null;

  // Strip checkbox HTML from the paragraph content
  const rest = fixed.filter(
    (c) => !(c.type.name === "html" && TASK_CHECKBOX.test(c.attrs.value)),
  );
  const newPara = first.type.create(first.attrs, rest);

  // Rebuild children: replace first paragraph with fixed version
  const kids: ProseNode[] = [newPara];
  node.content.forEach((c, _o, i) => {
    if (i > 0) kids.push(c);
  });

  return node.type.create({ kind: "task", checked }, kids);
}

/** Convert a paragraph-wrapped `<video>` html atom into a video node. */
function fixVideo(schema: Schema, node: ProseNode): ProseNode | null {
  const value = htmlInParagraph(node);
  if (!value || !/^<video\b/i.test(value.trim())) return null;
  if (!value.trim().endsWith("</video>") && !/\/>\s*$/.test(value.trim()))
    return null;
  return schema.nodes.video.create(parseVideoAttrs(value));
}

function fixBlockChildren(
  schema: Schema,
  children: readonly ProseNode[],
): ProseNode[] | null {
  const out: ProseNode[] = [];
  let changed = false;
  let i = 0;
  while (i < children.length) {
    const node = children[i];

    // empty paragraph preservation: `<br />` html atom -> empty paragraph
    const htmlOnly = htmlInParagraph(node);
    if (htmlOnly && BR_ONLY.test(htmlOnly.trim())) {
      out.push(schema.nodes.paragraph.create());
      changed = true;
      i++;
      continue;
    }

    // Also catch paragraphs whose text content is literally `<br />`
    // (from html_block tokens that markdown-it produces for standalone <br />)
    if (node.type.name === "paragraph" && node.childCount === 1) {
      const text = node.child(0).text;
      if (text && BR_ONLY.test(text.trim())) {
        out.push(schema.nodes.paragraph.create());
        changed = true;
        i++;
        continue;
      }
    }

    // <video ...>...</video>
    const video = fixVideo(schema, node);
    if (video) {
      out.push(video);
      changed = true;
      i++;
      continue;
    }

    // <div align="center"> ... </div>
    if (htmlOnly && DIV_CENTER_OPEN.test(htmlOnly.trim())) {
      let closeIdx = -1;
      for (let j = i + 1; j < children.length; j++) {
        const cv = htmlInParagraph(children[j]);
        if (cv && /^<\/div>\s*$/i.test(cv.trim())) {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx !== -1) {
        const inner = fixBlockChildren(
          schema,
          children.slice(i + 1, closeIdx),
        ) ?? [...children.slice(i + 1, closeIdx)];
        out.push(schema.nodes.divCenter.create({}, inner));
        changed = true;
        i = closeIdx + 1;
        continue;
      }
    }

    // blockquote -> alert when it opens with `> [!TYPE]`
    if (node.type.name === "blockquote") {
      const alert = fixAlert(schema, node);
      if (alert) {
        out.push(alert);
        changed = true;
        i++;
        continue;
      }
    }

    // paragraph containing only an image -> image-block
    if (
      node.type.name === "paragraph" &&
      node.childCount === 1 &&
      node.firstChild?.type.name === "image"
    ) {
      const img = node.firstChild;
      const { ratio, w, h } = parseAlt(img.attrs.alt);
      out.push(
        schema.nodes["image-block"].create({
          src: img.attrs.src,
          caption: img.attrs.title || "",
          ratio,
          w,
          h,
        }),
      );
      changed = true;
      i++;
      continue;
    }

    // list node: detect task items
    if (node.type.name === "list") {
      const fixed = fixTaskListItems(schema, node);
      if (fixed) {
        out.push(fixed);
        changed = true;
        i++;
        continue;
      }
    }

    // recurse into block containers
    if (node.isBlock && !node.isLeaf && node.childCount > 0) {
      const kids = fixBlockChildren(schema, node.content.content);
      if (kids) {
        out.push(node.copy(Fragment.from(kids)));
        changed = true;
        i++;
        continue;
      }
    }

    out.push(node);
    i++;
  }
  return changed ? out : null;
}

function fixAlert(schema: Schema, blockquote: ProseNode): ProseNode | null {
  const first = blockquote.firstChild;
  if (!first || first.type.name !== "paragraph") return null;
  const firstText = first.firstChild;
  if (!firstText || !firstText.isText) return null;
  const m = /^\[!([A-Z]+)\]\s*/i.exec(firstText.text || "");
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!ALERT_TYPES.includes(type)) return null;

  const rest = firstText.text!.slice(m[0].length);
  const paraKids: ProseNode[] = [];
  if (rest) paraKids.push(schema.text(rest, firstText.marks));
  first.content.forEach((c, _o, i) => {
    if (i > 0) paraKids.push(c);
  });
  const blocks: ProseNode[] = [];
  if (paraKids.length > 0)
    blocks.push(first.type.create(first.attrs, paraKids));
  blockquote.content.forEach((c, _o, i) => {
    if (i > 0) blocks.push(c);
  });
  return schema.nodes.alert.create({ type }, blocks);
}

/** Post-parse walk: rebuilds the doc with app-specific node fixups. */
export function fixUpDoc(schema: Schema, doc: ProseNode): ProseNode {
  const kids = fixBlockChildren(schema, doc.content.content);
  if (!kids) return doc;
  return doc.type.create(doc.attrs, kids);
}

// --- serializer -------------------------------------------------------------

function renderFlatList(
  state: MarkdownSerializerState,
  node: ProseNode,
  delim: string,
  firstDelim: (index: number, child: ProseNode) => string,
) {
  const anyState = state as any;
  if (anyState.closed && anyState.closed.type === node.type)
    anyState.flushClose(3);
  else if (anyState.inTightList) anyState.flushClose(1);

  // In ProseKit's flat-list model, list children are direct blocks.
  // "Tight" lists have paragraphs without wrapping; "loose" lists have
  // paragraphs with blank lines between them. We detect tightness by
  // checking if the first child is a paragraph with a single text node
  // (tight) vs multiple blocks (loose).
  const isTight =
    node.childCount === 1 &&
    node.firstChild?.type.name === "paragraph" &&
    node.firstChild?.childCount === 1 &&
    node.firstChild?.firstChild?.isText;
  const prevTight = anyState.inTightList;
  anyState.inTightList = isTight;
  node.forEach((child, _o, i) => {
    if (i && isTight) anyState.flushClose(1);
    state.wrapBlock(delim, firstDelim(i, child), node, () =>
      state.render(child, node, i),
    );
  });
  anyState.inTightList = prevTight;
}

function renderTable(state: MarkdownSerializerState, node: ProseNode) {
  // Find the first row that contains any header cells
  let headerRow: ProseNode | null = null;
  let headerRowIdx = -1;
  node.forEach((row, _o, i) => {
    if (headerRow) return;
    row.forEach((cell) => {
      if (cell.type.name === "tableHeaderCell" && !headerRow) {
        headerRow = row;
        headerRowIdx = i;
      }
    });
  });

  if (!headerRow) return;

  const align: string[] = [];
  (headerRow as ProseNode).forEach((cell: ProseNode) =>
    align.push(cell.attrs.alignment || "left"),
  );
  const ncols = (headerRow as ProseNode).childCount;

  const renderRow = (row: ProseNode): string => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const sub = new (MarkdownSerializerState as any)(
        (state as any).nodes,
        (state as any).marks,
        { ...(state as any).options, tightLists: false },
      );
      cell.forEach((p) => sub.render(p, cell, 0));
      cells.push((sub as any).out.trim().replace(/\|/g, "\\|"));
    });
    while (cells.length < ncols) cells.push("");
    return "| " + cells.join(" | ") + " |";
  };

  state.write(renderRow(headerRow) + "\n");
  const sep = align.map((a) =>
    a === "center" ? ":---:" : a === "right" ? "---:" : "---",
  );
  state.write("| " + sep.join(" | ") + " |");
  state.closeBlock(node);

  // Body rows
  node.forEach((row, _o, i) => {
    if (i === headerRowIdx) return;
    state.write("\n" + renderRow(row));
  });
}

export function createMarkdownSerializer(schema: Schema): MarkdownSerializer {
  const serializer = new MarkdownSerializer(
    {
      blockquote(state, node) {
        state.wrapBlock("> ", null, node, () => state.renderContent(node));
      },
      codeBlock(state, node) {
        const language = String(node.attrs.language || "").toLowerCase();
        if (language === "latex") {
          state.write("$$\n");
          state.text(node.textContent, false);
          state.write("\n$$");
          state.closeBlock(node);
          return;
        }
        const backticks = node.textContent.match(/`{3,}/gm);
        const fence = backticks
          ? backticks.sort().slice(-1)[0] + "`"
          : "```";
        state.write(
          fence + (language ? String(node.attrs.language) : "") + "\n",
        );
        state.text(node.textContent, false);
        state.write("\n");
        state.write(fence);
        state.closeBlock(node);
      },
      heading(state, node) {
        state.write(state.repeat("#", node.attrs.level) + " ");
        state.renderInline(node, false);
        state.closeBlock(node);
      },
      horizontalRule(state, node) {
        state.write("---");
        state.closeBlock(node);
      },
      list(state, node) {
        const kind = node.attrs.kind || "bullet";
        if (kind === "ordered") {
          const start = node.attrs.order ?? 1;
          const maxW = String(start + node.childCount - 1).length;
          const space = state.repeat(" ", maxW + 2);
          renderFlatList(state, node, space, (i) => {
            const nStr = String(start + i);
            return state.repeat(" ", maxW - nStr.length) + nStr + ". ";
          });
        } else if (kind === "task") {
          // Task lists: each direct block child is the content.
          // Prefix with [x] or [ ] based on the list node's checked attr.
          const checked = node.attrs.checked;
          const anyState = state as any;
          if (anyState.closed && anyState.closed.type === node.type)
            anyState.flushClose(3);
          else if (anyState.inTightList) anyState.flushClose(1);
          const prevTight = anyState.inTightList;
          anyState.inTightList = true;
          node.forEach((child, _o, i) => {
            if (i) anyState.flushClose(1);
            const prefix = `[${checked ? "x" : " "}] `;
            state.wrapBlock("  ", prefix, node, () =>
              state.render(child, node, i),
            );
          });
          anyState.inTightList = prevTight;
        } else {
          // bullet, toggle, and any other kind
          renderFlatList(state, node, "  ", () => "* ");
        }
      },
      paragraph(state, node, parent, index) {
        if (node.content.size === 0) {
          if (parent && index < parent.childCount - 1) {
            state.write("<br />");
            state.closeBlock(node);
            return;
          }
          state.closeBlock(node);
          return;
        }
        state.renderInline(node);
        state.closeBlock(node);
      },
      image(state, node) {
        const alt = node.attrs.alt || "";
        const src = String(node.attrs.src).replace(/[()]/g, "\\$&");
        const title = node.attrs.title
          ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
          : "";
        state.write(`![${alt}](${src}${title})`);
      },
      hardBreak(state, node, parent, index) {
        for (let i = index + 1; i < parent.childCount; i++)
          if (parent.child(i).type !== node.type) {
            state.write("\\\n");
            return;
          }
      },
      text(state, node) {
        if (node.text!.includes("{{")) state.write(node.text!);
        else state.text(node.text!, !(state as any).inAutolink);
      },
      alert(state, node) {
        const type = node.attrs.type || "note";
        state.wrapBlock("> ", null, node, () => {
          node.forEach((child, _o, i) => {
            if (i === 0 && child.type.name === "paragraph") {
              state.write(`[!${type.toUpperCase()}] `);
              state.renderInline(child, false);
              state.closeBlock(child);
            } else {
              state.render(child, node, i);
            }
          });
        });
      },
      video(state, node) {
        const a = node.attrs;
        let html = "<video";
        if (a.width) html += ` width="${a.width}"`;
        if (a.height) html += ` height="${a.height}"`;
        if (a.controls) html += " controls";
        if (a.loop) html += " loop";
        if (a.muted) html += " muted";
        if (a.autoplay) html += " autoplay";
        if (a.playsinline) html += " playsinline";
        if (a.poster) html += ` poster="${a.poster}"`;
        html += a.src ? ` src="${a.src}">` : ">";
        html += "</video>";
        state.write(html);
        state.closeBlock(node);
      },
      divCenter(state, node) {
        state.write('<div align="center">\n');
        state.renderContent(node);
        state.write("</div>");
        state.closeBlock(node);
      },
      hugoRef(state, node) {
        state.write(
          `[${node.attrs.title}](<{{% ref path="${node.attrs.path}" %}}>)`,
        );
      },
      "image-block"(state, node) {
        const a = node.attrs;
        const parts = [Number.parseFloat(String(a.ratio)).toFixed(2)];
        if (a.w > 0 || a.h > 0)
          parts.push(`w=${Math.round(a.w)}`, `h=${Math.round(a.h)}`);
        state.write(
          `![${parts.join(";")}](${String(a.src).replace(/[()]/g, "\\$&")}${
            a.caption ? ` "${String(a.caption).replace(/"/g, '\\"')}"` : ""
          })`,
        );
        state.closeBlock(node);
      },
      math_inline(state, node) {
        state.write("$" + node.attrs.value + "$");
      },
      html(state, node) {
        state.write(node.attrs.value);
      },
      table: renderTable,
      tableRow() {},
      tableCell(state, node) {
        state.renderContent(node);
      },
      tableHeaderCell(state, node) {
        state.renderContent(node);
      },
    },
    {
      italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
      bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
      link: {
        open(state, mark, parent, index) {
          const isPlain =
            !mark.attrs.title &&
            /^\w+:/.test(mark.attrs.href) &&
            parent.child(index).isText &&
            parent.child(index).text === mark.attrs.href &&
            index === parent.childCount - 1;
          (state as any).inAutolink = isPlain;
          return isPlain ? "<" : "[";
        },
        close(state, mark) {
          const inAutolink = (state as any).inAutolink;
          (state as any).inAutolink = undefined;
          return inAutolink
            ? ">"
            : "](" +
                String(mark.attrs.href).replace(/[()"]/g, "\\$&") +
                (mark.attrs.title
                  ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
                  : "") +
                ")";
        },
        mixable: true,
      },
      code: {
        open(_state, _mark, parent, index) {
          let len = 0;
          const text = parent.child(index).text || "";
          const m = /`+/g;
          let mm: RegExpExecArray | null;
          while ((mm = m.exec(text))) len = Math.max(len, mm[0].length);
          return len > 0 ? " `" : "`";
        },
        close(_state, _mark, parent, index) {
          let len = 0;
          const text = parent.child(index - 1).text || "";
          const m = /`+/g;
          let mm: RegExpExecArray | null;
          while ((mm = m.exec(text))) len = Math.max(len, mm[0].length);
          return len > 0 ? "` " : "`";
        },
        escape: false,
      },
      strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    },
    {
      tightLists: false,
      hardBreakNodeName: "hardBreak",
    } as any,
  );
  return serializer;
}

export function createMarkdownBridge(schema: Schema): ParseState {
  const parser = createMarkdownParser(schema);
  const serializer = createMarkdownSerializer(schema);
  return {
    schema,
    parse(text) {
      return fixUpDoc(schema, parser.parse(text));
    },
    serialize(doc) {
      return serializer.serialize(doc);
    },
  };
}
