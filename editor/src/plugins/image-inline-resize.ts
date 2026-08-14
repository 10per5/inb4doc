import { $view } from "@milkdown/utils";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { inlineImageConfig } from "@milkdown/kit/component/image-inline";
import type { NodeView } from "@milkdown/kit/prose/view";
import { parseAlt, encodeAlt } from "@/plugins/image-resize";

const MIN_SIZE = 32;

/**
 * Node view for the inline `image` node. Applies the same proxyDomURL as the
 * image-block (so pasted/dropped images in table cells render) and adds the
 * image-block resize handles when the image lives inside a table cell — where
 * `cellContent: "paragraph"` forces images to be inline nodes rather than
 * image-blocks. Resized dimensions persist through the alt encoding
 * (`1.00;w=320;h=240`) shared with image-block.
 */
export const imageInlineResizeView = $view(imageSchema.node, (ctx) => {
  return (initialNode, view, getPos): NodeView => {
    const config = ctx.get(inlineImageConfig.key);

    const wrapper = document.createElement("span");
    wrapper.className = "milkdown-image-inline";
    wrapper.contentEditable = "false";

    const frame = document.createElement("span");
    frame.className = "image-frame";

    const img = document.createElement("img");
    img.className = "image-inline";
    img.draggable = false;

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

    const handles = new Map<HandleDir, HTMLElement>();
    for (const dir of HANDLE_DIRS) {
      const h = document.createElement("span");
      h.className = `image-resize-handle image-resize-handle--${dir}`;
      h.dataset.dir = dir;
      handles.set(dir, h);
      frame.appendChild(h);
    }

    frame.appendChild(img);
    wrapper.appendChild(frame);

    let currentSrc = "";
    let currentW = 0;
    let currentH = 0;
    let naturalW = 0;
    let naturalH = 0;
    let inCell = false;

    const insideTableCell = (): boolean => {
      const pos = getPos();
      if (pos == null) return false;
      const d = view.state.doc.resolve(pos);
      for (let i = d.depth; i > 0; i--) {
        const name = d.node(i).type.name;
        if (name === "table_cell" || name === "table_header") return true;
      }
      return false;
    };

    const applySize = () => {
      if (!naturalW || !naturalH) return;
      const hostWidth = wrapper.getBoundingClientRect().width || 0;
      const maxW = hostWidth > 0 ? hostWidth : naturalW;
      const baseH = Math.min(maxW, naturalW) * (naturalH / naturalW);
      if (currentW > 0 && currentH > 0) {
        const scale = Math.min(1, maxW / currentW);
        img.style.width = `${Math.max(MIN_SIZE, currentW * scale)}px`;
        img.style.height = `${Math.max(MIN_SIZE, currentH * scale)}px`;
      } else {
        img.style.width = "auto";
        img.style.height = `${baseH}px`;
      }
    };

    img.addEventListener("load", () => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      applySize();
    });

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
      if (a.title) img.title = a.title;
      else img.removeAttribute("title");
      const size = parseAlt(a.alt);
      currentW = size.w;
      currentH = size.h;
      inCell = view.editable && insideTableCell();
      wrapper.classList.toggle("resizable", inCell);
      if (naturalW && naturalH) applySize();
    };

    const startResize = (e: PointerEvent, dir: HandleDir) => {
      if (!view.editable || !inCell) return;
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
          h = Math.max(MIN_SIZE, startH + vec.y * dy);
          w = h * aspect;
        } else {
          if (vec.x !== 0) w = Math.max(MIN_SIZE, startW + vec.x * dx);
          if (vec.y !== 0) h = Math.max(MIN_SIZE, startH + vec.y * dy);
        }
        const hostWidth = wrapper.getBoundingClientRect().width || 0;
        const maxW = hostWidth > 0 ? hostWidth : Infinity;
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
        setAttrs({ alt: encodeAlt(1, w, h) });
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    };

    for (const [dir, handle] of handles) {
      handle.addEventListener("pointerdown", (e) => startResize(e, dir));
    }

    bindAttrs(initialNode);

    return {
      dom: wrapper,
      update: (updatedNode) => {
        if (updatedNode.type !== initialNode.type) return false;
        bindAttrs(updatedNode);
        return true;
      },
      selectNode: () => wrapper.classList.add("selected"),
      deselectNode: () => wrapper.classList.remove("selected"),
      stopEvent: (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".image-resize-handle")) return true;
        return false;
      },
      ignoreMutation: () => true,
      destroy: () => {
        wrapper.remove();
      },
    };
  };
});
