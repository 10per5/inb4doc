import { defineMarkSpec, defineNodeSpec } from "@prosekit/core";
import type { Extension } from "@prosekit/core";
import { tableNodes } from "prosemirror-tables";

/**
 * ProseKit schema for the inb4doc editor.
 *
 * Node/mark names and DOM mapping mirror the Milkdown commonmark + gfm
 * presets (plus the app's custom nodes) so that existing plugin code,
 * CSS selectors, and the markdown corpus keep working unchanged.
 */

const IMAGE_DATA_TYPE = "image-block";
const MATH_INLINE_ID = "math_inline";

export const ALERT_TYPES = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "info",
  "success",
  "danger",
];

const headingIndex = [1, 2, 3, 4, 5, 6];

export function defaultHeadingIdGenerator(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, "-");
}

const baseTableSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {
    alignment: {
      default: "left",
      getFromDOM: (dom) => dom.style.textAlign || "left",
      setDOMAttr: (value: unknown, attrs: Record<string, unknown>) => {
        attrs.style = `text-align: ${value || "left"}`;
      },
    },
  },
});

/**
 * All node + mark schema extensions. Feed this (plus node views and prose
 * plugins) into `createEditor({ extension: [...] })`.
 */
export function createSchemaExtension(): Extension[] {
  return [
    defineNodeSpec({
      name: "doc",
      topNode: true,
      content: "(block | alertBlock)+",
    }),

    defineNodeSpec({
      name: "text",
      group: "inline",
      inline: true,
    }),

    defineNodeSpec({
      name: "paragraph",
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    }),

    defineNodeSpec({
      name: "heading",
      content: "inline*",
      group: "block",
      defining: true,
      attrs: {
        id: { default: "", validate: "string" },
        level: { default: 1, validate: "number" },
      },
      parseDOM: headingIndex.map((x) => ({
        tag: `h${x}`,
        getAttrs: (node: HTMLElement) => ({
          level: x,
          id: node.id,
        }),
      })),
      toDOM: (node) => [
        `h${node.attrs.level}`,
        { id: node.attrs.id || defaultHeadingIdGenerator(node.textContent) },
        0,
      ],
    }),

    defineNodeSpec({
      name: "blockquote",
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    }),

    defineNodeSpec({
      name: "code_block",
      content: "text*",
      group: "block",
      marks: "",
      defining: true,
      code: true,
      attrs: {
        language: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLElement) => ({ language: dom.dataset.language }),
        },
      ],
      toDOM: (node) => {
        const language = node.attrs.language;
        const languageAttrs =
          language && language.length > 0
            ? { "data-language": language }
            : undefined;
        return ["pre", languageAttrs, ["code", 0]];
      },
    }),

    defineNodeSpec({
      name: "bullet_list",
      content: "listItem+",
      group: "block",
      attrs: {
        spread: { default: false, validate: "boolean" },
      },
      parseDOM: [
        {
          tag: "ul",
          getAttrs: (dom: HTMLElement) => ({
            spread: dom.dataset.spread === "true",
          }),
        },
      ],
      toDOM: (node) => ["ul", { "data-spread": node.attrs.spread }, 0],
    }),

    defineNodeSpec({
      name: "ordered_list",
      content: "listItem+",
      group: "block",
      attrs: {
        order: { default: 1, validate: "number" },
        spread: { default: false, validate: "boolean" },
      },
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom: HTMLElement) => ({
            spread: dom.dataset.spread === "true",
            order: dom.hasAttribute("start")
              ? Number(dom.getAttribute("start"))
              : 1,
          }),
        },
      ],
      toDOM: (node) => [
        "ol",
        {
          ...(node.attrs.order === 1 ? {} : { start: node.attrs.order }),
          "data-spread": node.attrs.spread,
        },
        0,
      ],
    }),

    defineNodeSpec({
      name: "list_item",
      group: "listItem",
      content: "paragraph block*",
      defining: true,
      attrs: {
        label: { default: "\u2022", validate: "string" },
        listType: { default: "bullet", validate: "string" },
        spread: { default: true, validate: "boolean" },
        checked: { default: null, validate: "boolean|null" },
      },
      parseDOM: [
        {
          tag: 'li[data-item-type="task"]',
          getAttrs: (dom: HTMLElement) => ({
            label: dom.dataset.label,
            listType: dom.dataset.listType,
            spread: dom.dataset.spread === "true",
            checked: dom.dataset.checked
              ? dom.dataset.checked === "true"
              : null,
          }),
        },
        {
          tag: "li",
          getAttrs: (dom: HTMLElement) => ({
            label: dom.dataset.label,
            listType: dom.dataset.listType,
            spread: dom.dataset.spread === "true",
          }),
        },
      ],
      toDOM: (node) => {
        if (node.attrs.checked == null) {
          return [
            "li",
            {
              "data-label": node.attrs.label,
              "data-list-type": node.attrs.listType,
              "data-spread": node.attrs.spread,
            },
            0,
          ];
        }
        return [
          "li",
          {
            "data-item-type": "task",
            "data-label": node.attrs.label,
            "data-list-type": node.attrs.listType,
            "data-spread": node.attrs.spread,
            "data-checked": node.attrs.checked,
          },
          0,
        ];
      },
    }),

    defineNodeSpec({
      name: "hardbreak",
      inline: true,
      group: "inline",
      selectable: false,
      attrs: {
        isInline: { default: false, validate: "boolean" },
      },
      parseDOM: [
        { tag: "br" },
        {
          tag: 'span[data-type="hardbreak"]',
          getAttrs: () => ({ isInline: true }),
        },
      ],
      toDOM: (node) =>
        node.attrs.isInline
          ? ["span", { "data-type": "hardbreak", "data-is-inline": true }, " "]
          : ["br", { "data-type": "hardbreak", "data-is-inline": false }],
      leafText: () => "\n",
    }),

    defineNodeSpec({
      name: "hr",
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    }),

    defineNodeSpec({
      name: "html",
      atom: true,
      inline: true,
      group: "inline",
      attrs: {
        value: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: 'span[data-type="html"]',
          getAttrs: (dom: HTMLElement) => ({
            value: dom.dataset.value ?? "",
          }),
        },
      ],
      toDOM: (node) => [
        "span",
        { "data-type": "html", "data-value": node.attrs.value },
        node.attrs.value,
      ],
    }),

    defineNodeSpec({
      name: "image",
      inline: true,
      group: "inline",
      selectable: true,
      draggable: true,
      marks: "",
      atom: true,
      defining: true,
      isolating: true,
      attrs: {
        src: { default: "", validate: "string" },
        alt: { default: "", validate: "string" },
        title: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom: HTMLElement) => ({
            src: dom.getAttribute("src") || "",
            alt: dom.getAttribute("alt") || "",
            title: dom.getAttribute("title") || dom.getAttribute("alt") || "",
          }),
        },
      ],
      toDOM: (node) => ["img", { ...node.attrs }],
    }),

    defineNodeSpec({
      name: "table",
      ...baseTableSpecs.table,
      content: "table_header_row table_row+",
      disableDropCursor: true,
    }),

    defineNodeSpec({
      name: "table_header_row",
      content: "(table_header)*",
      tableRole: "row",
      group: "block",
      disableDropCursor: true,
      parseDOM: [
        { tag: "tr[data-is-header]" },
        {
          tag: "tr",
          getAttrs: (dom: HTMLElement) => {
            if (dom instanceof HTMLElement) {
              return dom.querySelector("th") ? {} : false;
            }
            return false;
          },
        },
      ],
      toDOM: () => ["tr", { "data-is-header": true }, 0],
    }),

    defineNodeSpec({
      name: "table_row",
      content: "(table_cell)*",
      tableRole: "row",
      group: "block",
      disableDropCursor: true,
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    }),

    defineNodeSpec({
      name: "table_header",
      ...baseTableSpecs.table_header,
      disableDropCursor: true,
    }),

    defineNodeSpec({
      name: "table_cell",
      ...baseTableSpecs.table_cell,
      disableDropCursor: true,
    }),

    defineNodeSpec({
      name: "image-block",
      inline: false,
      group: "block",
      selectable: true,
      draggable: true,
      isolating: true,
      marks: "",
      atom: true,
      attrs: {
        src: { default: "", validate: "string" },
        caption: { default: "", validate: "string" },
        ratio: { default: 1, validate: "number" },
        w: { default: 0, validate: "number" },
        h: { default: 0, validate: "number" },
      },
      parseDOM: [
        {
          tag: `img[data-type="${IMAGE_DATA_TYPE}"]`,
          getAttrs: (dom: HTMLElement) => {
            const num = (v: string | null): number => {
              const n = Number(v ?? 0);
              return Number.isNaN(n) || n <= 0 ? 0 : n;
            };
            return {
              src: dom.getAttribute("src") || "",
              caption: dom.getAttribute("caption") || "",
              ratio: num(dom.getAttribute("ratio")) || 1,
              w: num(dom.getAttribute("w")),
              h: num(dom.getAttribute("h")),
            };
          },
        },
      ],
      toDOM: (node) => {
        const a = node.attrs;
        const attrs: Record<string, string> = { "data-type": IMAGE_DATA_TYPE };
        for (const key of ["src", "caption", "ratio", "w", "h"] as const) {
          const v = a[key];
          if (v !== undefined && v !== null && v !== "")
            attrs[key] = String(v);
        }
        return ["img", attrs];
      },
    }),

    defineNodeSpec({
      name: MATH_INLINE_ID,
      group: "inline",
      inline: true,
      draggable: true,
      atom: true,
      attrs: {
        value: { default: "" },
      },
      parseDOM: [
        {
          tag: `span[data-type="${MATH_INLINE_ID}"]`,
          getAttrs: (dom: HTMLElement) => ({
            value: dom.dataset.value ?? "",
          }),
        },
      ],
      toDOM: (node) => {
        const dom = document.createElement("span");
        dom.dataset.type = MATH_INLINE_ID;
        dom.dataset.value = node.attrs.value;
        dom.textContent = node.attrs.value;
        return dom;
      },
    }),

    defineNodeSpec({
      name: "video",
      group: "block",
      selectable: true,
      draggable: true,
      isolating: true,
      marks: "",
      atom: true,
      attrs: {
        src: { default: "", validate: "string" },
        poster: { default: "", validate: "string" },
        controls: { default: true },
        loop: { default: false },
        muted: { default: false },
        autoplay: { default: false },
        playsinline: { default: false },
        width: { default: "", validate: "string" },
        height: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: "div.video-wrapper",
          getAttrs: (dom: HTMLElement) => {
            const el = dom;
            const video = el.querySelector("video");
            return {
              src:
                video?.getAttribute("src") || el.getAttribute("data-src") || "",
              poster: video?.getAttribute("poster") || "",
              controls: video?.hasAttribute("controls") ?? true,
              loop: video?.hasAttribute("loop") ?? false,
              muted: video?.hasAttribute("muted") ?? false,
              autoplay: video?.hasAttribute("autoplay") ?? false,
              playsinline: video?.hasAttribute("playsinline") ?? false,
              width: video?.getAttribute("width") || "",
              height: video?.getAttribute("height") || "",
            };
          },
        },
        {
          tag: "video",
          getAttrs: (dom: HTMLElement) => {
            const el = dom as HTMLVideoElement;
            const source = el.querySelector("source");
            return {
              src: source?.getAttribute("src") || el.getAttribute("src") || "",
              poster: el.getAttribute("poster") || "",
              controls: el.hasAttribute("controls"),
              loop: el.hasAttribute("loop"),
              muted: el.hasAttribute("muted"),
              autoplay: el.hasAttribute("autoplay"),
              playsinline: el.hasAttribute("playsinline"),
              width: el.getAttribute("width") || "",
              height: el.getAttribute("height") || "",
            };
          },
        },
      ],
      toDOM: (node) => {
        const a = node.attrs;
        const videoAttrs: Record<string, string> = {};
        if (a.poster) videoAttrs.poster = a.poster;
        if (a.width) videoAttrs.width = a.width;
        if (a.height) videoAttrs.height = a.height;
        if (a.controls) videoAttrs.controls = "";
        if (a.loop) videoAttrs.loop = "";
        if (a.muted) videoAttrs.muted = "";
        if (a.autoplay) videoAttrs.autoplay = "";
        if (a.playsinline) videoAttrs.playsinline = "";
        if (a.src) videoAttrs.src = a.src;
        return [
          "div",
          { class: "video-wrapper", "data-type": "video" },
          ["video", videoAttrs],
        ];
      },
    }),

    defineNodeSpec({
      name: "alert",
      group: "alertBlock",
      content: "block+",
      defining: true,
      attrs: {
        type: { default: "note", validate: "string" },
      },
      parseDOM: [
        {
          tag: "blockquote.book-hint",
          getAttrs: (dom: HTMLElement) => {
            for (const t of ALERT_TYPES) {
              if (dom.classList.contains(t)) return { type: t };
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
    }),

    defineNodeSpec({
      name: "divCenter",
      group: "alertBlock",
      content: "block+",
      defining: true,
      marks: "",
      attrs: {},
      parseDOM: [{ tag: "div[align=center]" }],
      toDOM: () => ["div", { align: "center", "data-type": "div-center" }, 0],
    }),

    defineNodeSpec({
      name: "hugoRef",
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        path: { default: "" },
        title: { default: "" },
      },
      parseDOM: [
        {
          tag: "span[data-hugo-ref]",
          getAttrs: (dom: HTMLElement) => ({
            path: dom.getAttribute("data-hugo-ref") || "",
            title: dom.getAttribute("data-title") || "",
          }),
        },
      ],
      toDOM: (node) => [
        "span",
        {
          "data-hugo-ref": node.attrs.path,
          "data-title": node.attrs.title,
          class: "hugo-ref-link",
        },
        node.attrs.title,
      ],
    }),

    defineMarkSpec({
      name: "strong",
      attrs: {
        marker: { default: "*", validate: "string" },
      },
      parseDOM: [
        {
          tag: "b",
          getAttrs: (node: HTMLElement) =>
            node.style.fontWeight !== "normal" && null,
        },
        { tag: "strong" },
        {
          style: "font-style",
          getAttrs: (value: string) => (value === "bold") as false,
        },
        { style: "font-weight=400", clearMark: (m) => m.type.name === "strong" },
        {
          style: "font-weight",
          getAttrs: (value: string) =>
            /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
        },
      ],
      toDOM: () => ["strong", 0],
    }),

    defineMarkSpec({
      name: "emphasis",
      attrs: {
        marker: { default: "*", validate: "string" },
      },
      parseDOM: [
        { tag: "i" },
        { tag: "em" },
        {
          style: "font-style",
          getAttrs: (value: string) => (value === "italic") as false,
        },
      ],
      toDOM: () => ["em", 0],
    }),

    defineMarkSpec({
      name: "inlineCode",
      priority: 100,
      code: true,
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    }),

    defineMarkSpec({
      name: "link",
      attrs: {
        href: { validate: "string" },
        title: { default: null, validate: "string|null" },
      },
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom: HTMLElement) => ({
            href: dom.getAttribute("href"),
            title: dom.getAttribute("title"),
          }),
        },
      ],
      toDOM: (mark) => ["a", { ...mark.attrs }, 0],
    }),

    defineMarkSpec({
      name: "strike_through",
      parseDOM: [
        { tag: "del" },
        {
          style: "text-decoration",
          getAttrs: (value: string) => (value === "line-through") as false,
        },
      ],
      toDOM: () => ["del", 0],
    }),
  ];
}
