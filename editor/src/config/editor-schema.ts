import { defineNodeSpec, defineMarkSpec, union } from "@prosekit/core";
import type { Extension } from "@prosekit/core";
import { defineBasicExtension } from "@prosekit/basic";

/**
 * ProseKit schema for the inb4doc editor.
 *
 * Uses defineBasicExtension() as the foundation for all standard nodes/marks,
 * then overrides specific specs and adds app-specific custom nodes.
 * Node/mark names match ProseKit conventions (camelCase for nodes, short
 * mark names).
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

/**
 * All node + mark schema extensions. Uses defineBasicExtension() as the base
 * (providing all standard nodes, marks, keymaps, commands, history, etc.),
 * then overrides specs where our app needs different behavior, and adds
 * custom app-specific nodes.
 */
export function createSchemaExtension(): Extension {
  return union(
    // Base: doc, text, paragraph, heading, list, blockquote, image,
    // horizontalRule, hardBreak, table, codeBlock, bold, italic, underline,
    // strike, code, link, baseKeymap, baseCommands, history, gapCursor,
    // virtualSelection, modClickPrevention
    defineBasicExtension(),

    // --- Overrides ---

    // Doc: accept alertBlock group in addition to block
    defineNodeSpec({
      name: "doc",
      topNode: true,
      content: "(block | alertBlock)+",
    }),

    // Heading: add id attribute for anchor links
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

    // Image: keep as inline atom (ProseKit default is block atom)
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

    // Link: keep title attribute (ProseKit default has target/rel instead)
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

    // --- Custom app nodes ---

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
  );
}
