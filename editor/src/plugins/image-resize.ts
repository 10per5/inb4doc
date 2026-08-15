import { $nodeSchema, $view } from "@milkdown/utils";
import {
  imageBlockConfig,
  IMAGE_DATA_TYPE,
} from "@milkdown/kit/component/image-block";
import type { NodeView } from "@milkdown/kit/prose/view";

const MIN_SIZE = 32;

/**
 * Alt encoding for persisted size, backward-compatible with the stock
 * image-block serialization (`![1.00](src "caption")`):
 *
 *   - no explicit size  → `1.00` (ratio only)
 *   - explicit size     → `1.00;w=320;h=240`
 *
 * Legacy `ratio`-only alts keep working; once a non-proportional (edge) drag
 * happens, `w`/`h` win and `ratio` is reset to 1.
 */
export function parseAlt(
  alt: string | undefined | null
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

export function encodeAlt(ratio: number, w: number, h: number): string {
  const parts = [Number.parseFloat(String(ratio)).toFixed(2)];
  if (w > 0 || h > 0) {
    parts.push(`w=${Math.round(w)}`, `h=${Math.round(h)}`);
  }
  return parts.join(";");
}

export const imageResizeSchema = $nodeSchema("image-block", () => ({
  inline: false,
  group: "block",
  selectable: true,
  draggable: true,
  isolating: true,
  marks: "",
  atom: true,
  priority: 100,
  attrs: {
    src: { default: "", validate: "string" },
    caption: { default: "", validate: "string" },
    ratio: { default: 1, validate: "number" },
    // Explicit pixel size. 0 = not set (fall back to `ratio`).
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
      if (v !== undefined && v !== null && v !== "") attrs[key] = String(v);
    }
    return ["img", attrs];
  },
  parseMarkdown: {
    match: ({ type }) => type === "image-block",
    runner: (state, node, type) => {
      const n = node as any;
      const { ratio, w, h } = parseAlt(n.alt);
      state.addNode(type, {
        src: n.url || "",
        caption: n.title || "",
        ratio,
        w,
        h,
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "image-block",
    runner: (state, node) => {
      const a = node.attrs;
      state.openNode("paragraph");
      state.addNode("image", void 0, void 0, {
        title: a.caption,
        url: a.src,
        alt: encodeAlt(a.ratio, a.w, a.h),
      });
      state.closeNode();
    },
  },
}));

const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleDir = (typeof HANDLE_DIRS)[number];

const DIR_VECTOR: Record<
  HandleDir,
  { x: number; y: number; corner: boolean }
> = {
  nw: { x: -1, y: -1, corner: true },
  n: { x: 0, y: -1, corner: false },
  ne: { x: 1, y: -1, corner: true },
  e: { x: 1, y: 0, corner: false },
  se: { x: 1, y: 1, corner: true },
  s: { x: 0, y: 1, corner: false },
  sw: { x: -1, y: 1, corner: true },
  w: { x: -1, y: 0, corner: false },
};

export const imageResizeView = $view(imageResizeSchema.node, (ctx) => {
  return (initialNode, view, getPos): NodeView => {
    const config = ctx.get(imageBlockConfig.key);

    const block = document.createElement("div");
    block.className = "milkdown-image-block";
    block.contentEditable = "false";

    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";

    const frame = document.createElement("div");
    frame.className = "image-frame";

    const img = document.createElement("img");
    img.setAttribute("data-type", IMAGE_DATA_TYPE);
    img.draggable = false;

    const operation = document.createElement("div");
    operation.className = "operation";
    const captionToggle = document.createElement("div");
    captionToggle.className = "operation-item";
    captionToggle.title = "Toggle caption";
    captionToggle.innerHTML = config.captionIcon ?? "";
    operation.appendChild(captionToggle);

    const handles = new Map<HandleDir, HTMLElement>();
    for (const dir of HANDLE_DIRS) {
      const h = document.createElement("div");
      h.className = `image-resize-handle image-resize-handle--${dir}`;
      h.dataset.dir = dir;
      handles.set(dir, h);
      frame.appendChild(h);
    }

    const captionInput = document.createElement("input");
    captionInput.className = "caption-input";
    captionInput.placeholder = config.captionPlaceholderText ?? "";
    captionInput.draggable = true;
    captionInput.addEventListener("dragstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    frame.appendChild(img);
    frame.appendChild(operation);
    wrapper.appendChild(frame);
    block.appendChild(wrapper);
    block.appendChild(captionInput);

    let currentSrc = "";
    let currentRatio = 1;
    let currentW = 0;
    let currentH = 0;
    let naturalW = 0;
    let naturalH = 0;
    let baseH = 0;
    let showCaption = false;
    let captionTimer = 0;

    const maxWidth = (): number => {
      const hostWidth = block.getBoundingClientRect().width || 0;
      if (config.maxWidth && config.maxWidth < hostWidth)
        return config.maxWidth;
      return hostWidth;
    };

    const applySize = () => {
      if (!naturalW || !naturalH) return;
      const maxW = maxWidth() || naturalW;
      const aspect = naturalW / naturalH;
      const withMaxHeight = (h: number) =>
        config.maxHeight ? Math.min(h, config.maxHeight) : h;
      if (currentW > 0 && currentH > 0) {
        const scale = Math.min(1, maxW / currentW);
        img.style.width = `${Math.max(MIN_SIZE, currentW * scale)}px`;
        img.style.height = `${Math.max(MIN_SIZE, withMaxHeight(currentH * scale))}px`;
      } else if (currentW > 0) {
        const w = Math.min(currentW, maxW);
        img.style.width = `${Math.max(MIN_SIZE, w)}px`;
        img.style.height = `${Math.max(MIN_SIZE, withMaxHeight(w / aspect))}px`;
      } else if (currentH > 0) {
        let h = currentH;
        let w = h * aspect;
        if (w > maxW) {
          w = maxW;
          h = w / aspect;
        }
        img.style.width = `${Math.max(MIN_SIZE, w)}px`;
        img.style.height = `${Math.max(MIN_SIZE, withMaxHeight(h))}px`;
      } else {
        baseH = Math.min(maxW, naturalW) / aspect;
        if (config.maxHeight) baseH = Math.min(baseH, config.maxHeight);
        img.style.width = "auto";
        img.style.height = `${baseH * currentRatio}px`;
      }
    };

    img.addEventListener("load", () => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      applySize();
    });

    const syncCaption = () => {
      captionInput.style.display = showCaption ? "" : "none";
    };

    const setAttrs = (attrs: Record<string, unknown>) => {
      if (!view.editable) return;
      const pos = getPos();
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [attr, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, attr, value);
      }
      view.dispatch(tr);
    };

    const bindAttrs = (node: any) => {
      const a = node.attrs ?? {};
      currentRatio = typeof a.ratio === "number" ? a.ratio : 1;
      currentW = typeof a.w === "number" ? a.w : 0;
      currentH = typeof a.h === "number" ? a.h : 0;
      const src = a.src || "";
      if (src !== currentSrc) {
        currentSrc = src;
        const proxy = config.proxyDomURL;
        if (proxy) {
          const resolved = proxy(src);
          if (typeof resolved === "string") {
            img.src = resolved;
          } else if (resolved && typeof resolved.then === "function") {
            resolved
              .then((u) => {
                img.src = u;
              })
              .catch(() => {});
          } else {
            img.src = src;
          }
        } else {
          img.src = src;
        }
      }
      if (a.caption) {
        captionInput.value = a.caption;
        showCaption = true;
      }
      syncCaption();
      if (naturalW && naturalH) applySize();
    };

    const setCaption = (value: string) => {
      if (!view.editable) return;
      setAttrs({ caption: value });
    };

    captionToggle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view.editable) return;
      showCaption = !showCaption;
      if (!showCaption) {
        captionInput.value = "";
        setCaption("");
      }
      syncCaption();
    });

    captionInput.addEventListener("input", () => {
      if (captionTimer) window.clearTimeout(captionTimer);
      const value = captionInput.value;
      captionTimer = window.setTimeout(() => setCaption(value), 800);
    });

    captionInput.addEventListener("blur", () => {
      if (captionTimer) {
        window.clearTimeout(captionTimer);
        captionTimer = 0;
      }
      setCaption(captionInput.value);
    });

    const startResize = (e: PointerEvent, dir: HandleDir) => {
      if (!view.editable) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);

      const rect = img.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      const startX = e.clientX;
      const startY = e.clientY;
      const vec = DIR_VECTOR[dir];
      const aspect = naturalW && naturalH ? naturalW / naturalH : 1;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        ev.preventDefault();
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let w = startW;
        let h = startH;
        if (vec.corner) {
          // Corners keep proportion (drive by the dominant axis).
          h = Math.max(MIN_SIZE, startH + vec.y * dy);
          w = h * aspect;
        } else {
          if (vec.x !== 0) w = Math.max(MIN_SIZE, startW + vec.x * dx);
          if (vec.y !== 0) h = Math.max(MIN_SIZE, startH + vec.y * dy);
        }
        const maxW = maxWidth() || Infinity;
        if (w > maxW) {
          w = maxW;
          if (vec.corner) h = w / aspect;
        }
        img.style.width = `${w}px`;
        img.style.height = `${h}px`;
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}
        const rect = img.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        currentW = w;
        currentH = h;
        currentRatio = 1;
        setAttrs({ w, h, ratio: 1 });
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    };

    for (const [dir, handle] of handles) {
      handle.addEventListener("pointerdown", (e) => startResize(e, dir));
    }

    bindAttrs(initialNode);

    return {
      dom: block,
      update: (updatedNode) => {
        if (updatedNode.type.name !== "image-block") return false;
        bindAttrs(updatedNode);
        return true;
      },
      selectNode: () => block.classList.add("selected"),
      deselectNode: () => block.classList.remove("selected"),
      stopEvent: (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".image-resize-handle")) return true;
        if (target?.closest(".operation")) return true;
        if (target instanceof HTMLInputElement) return true;
        return false;
      },
      ignoreMutation: () => true,
      destroy: () => {
        if (captionTimer) window.clearTimeout(captionTimer);
        block.remove();
      },
    };
  };
});
