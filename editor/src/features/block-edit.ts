import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { editorViewCtx } from "@milkdown/kit/core";
import { block, BlockProvider, blockConfig } from "@milkdown/kit/plugin/block";
import { slashFactory, SlashProvider } from "@milkdown/kit/plugin/slash";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { Menu } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { isMobileDock } from "@/utils/mobile";
import { executeInsertCommand } from "@/features/insert-command";
import { menuAPI, type MenuAPI } from "@/features/menu-api";
import {
  plus,
  menuScale,
  text,
  list,
  numberedListLeft,
  quote,
  minus,
  codeBrackets,
  mathBook,
  table,
  checkSquare,
  mediaImage,
  videoCamera,
} from "@/eta/icons";
import { defaultVideoAttrs } from "@/plugins/video";
import { openVideoDialog, type VideoDialogResult } from "@/controllers/dialog/video-dialog";
import { imageService } from "@/services/image-service";
import {
  SlashCommand, SLASH_CMD_PREFIX,
  ImageAction, IMG_ACTION_PREFIX,
  ProseNodeType, proseNodeTypeByName,
} from "@/config/enums";

const slash = slashFactory("inb4doc");

type SlashItem = { cmd: SlashCommand; label: string; icon: string; level?: number };
const SLASH_ITEMS: SlashItem[] = [
  { cmd: SlashCommand.Heading, label: "Heading 1", icon: text, level: 1 },
  { cmd: SlashCommand.Heading, label: "Heading 2", icon: text, level: 2 },
  { cmd: SlashCommand.Heading, label: "Heading 3", icon: text, level: 3 },
  { cmd: SlashCommand.BulletList, label: "Bullet List", icon: list },
  { cmd: SlashCommand.OrderedList, label: "Ordered List", icon: numberedListLeft },
  { cmd: SlashCommand.TodoList, label: "Task List", icon: checkSquare },
  { cmd: SlashCommand.Blockquote, label: "Blockquote", icon: quote },
  { cmd: SlashCommand.ThematicBreak, label: "Divider", icon: minus },
  { cmd: SlashCommand.CodeBlock, label: "Code Block", icon: codeBrackets },
  { cmd: SlashCommand.MathBlock, label: "Math Block (LaTeX)", icon: mathBook },
  { cmd: SlashCommand.Table, label: "Table", icon: table },
  { cmd: SlashCommand.Image, label: "Image", icon: mediaImage },
  { cmd: SlashCommand.Video, label: "Video", icon: videoCamera },
];

class BlockHandleView {
  #content: HTMLElement;
  #provider: BlockProvider;
  #ctx: Ctx;
  #menu: Menu | null = null;
  #menuAnchor: HTMLElement | null = null;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    const content = document.createElement("div");
    content.className = "milkdown-block-handle";
    content.innerHTML = `
      <button class="block-handle-add" title="Add paragraph below">${plus}</button>
      <button class="block-handle-drag" title="Drag to move">${menuScale}</button>
    `;
    content
      .querySelector(".block-handle-add")
      ?.addEventListener("pointerup", (e) => {
        e.preventDefault();
        this.onAdd();
      });

    this.#content = content;
    this.#provider = new BlockProvider({
      ctx,
      content,
      getOffset: () => {
        const w = window.innerWidth;
        const rem =
          parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        if (w >= 1350) return Math.round(0.5 * rem);
        if (w >= 700) return 16;
        return Math.round(0.25 * rem);
      },
      getPlacement: ({ active, blockDom }) => {
        if (window.innerWidth < 700) return "right-start";
        const dom = active.el;
        const domRect = dom.getBoundingClientRect();
        const handleRect = blockDom.getBoundingClientRect();
        const style = window.getComputedStyle(dom);
        const paddingTop = Number.parseInt(style.paddingTop, 10) || 0;
        const paddingBottom = Number.parseInt(style.paddingBottom, 10) || 0;
        const height = domRect.height - paddingTop - paddingBottom;
        const handleHeight = handleRect.height;
        return handleHeight < height ? "left-start" : "left";
      },
      getPosition: ({ active }) => {
        const w = window.innerWidth;
        const domRect = active.el.getBoundingClientRect();
        const style = window.getComputedStyle(active.el);
        let paddingTop = Number.parseInt(style.paddingTop, 10) || 10;
        const paddingBottom = Number.parseInt(style.paddingBottom, 10) || 0;
        const rem =
          parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        let left: number;
        if (w >= 1350) {
          const prose = document.querySelector("#editor-area .ProseMirror");
          const proseRect = prose?.getBoundingClientRect();
          left = proseRect
            ? proseRect.left + Math.round(2 * rem)
            : domRect.left;
        } else if (w >= 800) {
          // The left column can be the nav tree OR — at tablet width, when the
          // meta panel is open — the meta panel pulled into the left gutter
          // (lib/style/layout.css: .book-leftpanel display:none, .book-rightpanel
          // order:-1). Anchor to whichever left panel is actually visible.
          const navEl = document.querySelector(".book-leftpanel");
          const navRect = navEl?.getBoundingClientRect();
          let panelRight: number | null = null;
          if (navRect && navRect.width > 0) {
            panelRight = navRect.right;
          } else if (w < 1200) {
            const metaEl = document.querySelector(".book-rightpanel");
            const metaRect = metaEl?.getBoundingClientRect();
            if (metaRect && metaRect.width > 0) panelRight = metaRect.right;
          }
          left =
            panelRight !== null
              ? panelRight + Math.round(4.25 * rem)
              : domRect.left;
        } else {
          left = domRect.right + Math.round(1.25 * rem);
          paddingTop -= 12.5;
        }
        return {
          x: left,
          y: domRect.y + paddingTop,
          width: 0,
          height: domRect.height - paddingTop - paddingBottom,
          top: domRect.y + paddingTop,
          left,
          bottom: domRect.y + domRect.height - paddingBottom,
          right: left,
        };
      },
    });
    this.#provider.update();
  }

  update = () => {
    this.#provider.update();
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
    this.#menu?.destroy();
    this.#menuAnchor?.remove();
  };

  private onAdd = () => {
    const ctx = this.#ctx;
    const view = ctx.get(editorViewCtx);
    if (!view.hasFocus()) view.focus();
    const active = this.#provider.active;
    if (!active) return;
    const $pos = active.$pos;
    const pos = $pos.pos + active.node.nodeSize;
    const tr = view.state.tr.insert(pos, paragraphSchema.type(ctx).create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    view.dispatch(tr.scrollIntoView());
    this.#provider.hide();
    this.openAddMenu();
  };

  // Open the shared "add-block" menu (same definition the mobile FAB "+"
  // popup uses) anchored at the block-handle add button. The panel lives in a
  // body-level position:fixed mount — NOT inside the floating handle, which
  // fades on mouse-leave and would hide the panel. The caret already sits in
  // the fresh empty paragraph below the active block, so the menu's commands
  // (appendBelow) convert it in place.
  private openAddMenu() {
    if (!this.#menu) {
      const anchor = document.createElement("div");
      anchor.className = "block-handle-menu-anchor";
      document.body.appendChild(anchor);
      this.#menuAnchor = anchor;
      this.#menu = new Menu({
        mountEl: anchor,
        triggerEl: this.#content.querySelector(
          ".block-handle-add",
        ) as HTMLElement,
        label: "Add",
        items: () => menuRegistry.get("add-block")!,
      });
    }
    const btn = this.#content.querySelector<HTMLElement>(".block-handle-add");
    const rect = btn?.getBoundingClientRect();
    if (rect && this.#menuAnchor) {
      this.#menuAnchor.style.left = `${rect.left}px`;
      this.#menuAnchor.style.top = `${rect.bottom}px`;
    }
    this.#menu?.openAndFocusFirst();
  }
}

class SlashView {
  provider: SlashProvider;
  content: HTMLElement;
  private view: EditorView;
  private milkdownCtx: Ctx;
  private activeIndex = 0;
  private handleKeydown: (e: KeyboardEvent) => void;
  private filterText = "";
  #programmaticPos: number | null = null;
  #programmaticActive = false;
  #imageSlashStart: number = -1;
  #editState:
    | { type: "create" }
    | { type: "edit"; pos: number; src: string }
    | null = null;
  #imageMode = false;

  constructor(view: EditorView, ctx: Ctx) {
    this.view = view;
    this.milkdownCtx = ctx;
    this.content = document.createElement("div");
    this.content.className = "milkdown-slash";
    this.content.dataset.show = "false";

    this.content.addEventListener("pointerdown", (e) => {
      const item = (e.target as HTMLElement).closest(
        "[data-cmd], [data-img-action]",
      ) as HTMLElement;
      if (!item) return;
      e.preventDefault();
      this.execute(item);
    });

    this.handleKeydown = (e: KeyboardEvent) => {
      if (this.content.dataset.show !== "true") return;
      const domItems = this.content.querySelectorAll<HTMLElement>("[data-cmd]");
      if (domItems.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        this.activeIndex = (this.activeIndex + 1) % domItems.length;
        this.highlight(domItems);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        this.activeIndex =
          (this.activeIndex - 1 + domItems.length) % domItems.length;
        this.highlight(domItems);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const domItem = domItems[this.activeIndex];
        if (domItem) this.execute(domItem);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.#programmaticActive = false;
        this.provider.hide();
      }
    };
    view.dom.addEventListener("inb4doc:edit-image", ((e: CustomEvent) => {
      const { pos, src } = e.detail;
      this.openImageEditor(pos, src);
    }) as EventListener);

    view.dom.addEventListener("inb4doc:edit-video", ((e: CustomEvent) => {
      const { pos, attrs } = e.detail;
      this.openVideoEditor(pos, attrs);
    }) as EventListener);

    document.addEventListener("keydown", this.handleKeydown, true);

    const self = this;
    this.provider = new SlashProvider({
      content: this.content,
      debounce: 20,
      shouldShow(view) {
        if (typeof self.#programmaticPos === "number") {
          const maxSize = view.state.doc.nodeSize - 2;
          const validPos = Math.min(self.#programmaticPos, maxSize);
          if (
            view.state.doc.resolve(validPos).node() !==
            view.state.doc.resolve(view.state.selection.from).node()
          ) {
            self.#programmaticPos = null;
            self.#imageMode = false;
            return false;
          }
          self.#programmaticPos = null;
          if (self.#imageMode) {
            self.#imageMode = false;
            return true;
          }
          self.filterText = "";
          self.renderItems();
          return true;
        }
        const text = (this as any).getContent(view, (node: any) =>
          [ProseNodeType.Paragraph, ProseNodeType.Heading].includes(proseNodeTypeByName.get(node.type.name)!),
        );
        if (text == null) return false;
        if (!text.startsWith("/")) return false;
        self.filterText = text.slice(1);
        self.renderItems();
        return true;
      },
    });

    this.provider.onShow = () => {
      this.activeIndex = 0;
      const domItems = this.content.querySelectorAll<HTMLElement>("[data-cmd]");
      this.highlight(domItems);
    };

    ctx.set(
      menuAPI.key as any,
      {
        show: (pos: number) => this.showAt(pos),
        hide: () => this.provider.hide(),
      } as MenuAPI,
    );
  }

  update(view: EditorView, prevState?: EditorState) {
    this.view = view;
    this.provider.update(view, prevState);
  }

  destroy() {
    document.removeEventListener("keydown", this.handleKeydown, true);
    this.provider.destroy();
  }

  private showAt(pos: number) {
    this.filterText = "";
    this.renderItems();
    this.#programmaticPos = pos;
    this.#programmaticActive = true;
    this.provider.show();
  }

  private renderItems() {
    const filter = this.filterText.toLowerCase();
    const filtered = filter
      ? SLASH_ITEMS.filter((it) => it.label.toLowerCase().includes(filter))
      : SLASH_ITEMS;
    this.content.innerHTML = filtered
      .map(
        (it) =>
          `<div data-cmd="${SLASH_CMD_PREFIX}${it.cmd}" data-level="${it.level ?? ""}" class="slash-item">
            <span class="slash-icon">${it.icon}</span>
            <span class="slash-label">${it.label}</span>
          </div>`,
      )
      .join("");
  }

  private execute(item: HTMLElement) {
    const imgActionStr = item.dataset.imgAction;
    const cmdStr = item.dataset.cmd;
    const level = parseInt(item.dataset.level || "0");
    const view = this.view;
    const isProgrammatic = this.#programmaticActive;
    this.#programmaticActive = false;

    // Image picker commands (via data-img-action)
    if (imgActionStr) {
      const imgAction = Number(imgActionStr.replace(IMG_ACTION_PREFIX, "")) as ImageAction;
      if (imgAction === ImageAction.Select) {
        const url = item.dataset.url || "";
        if (url) this.confirmImageUrl(url);
        return;
      }
      if (imgAction === ImageAction.UrlSubmit) {
        const input = this.content.querySelector(
          ".slash-url-input",
        ) as HTMLInputElement;
        const url = input?.value.trim() || "";
        if (url) this.confirmImageUrl(url);
        return;
      }
      if (imgAction === ImageAction.Cancel) {
        this.#editState = null;
        this.provider.hide();
        this.view.focus();
        return;
      }
      if (imgAction === ImageAction.Remove) {
        if (this.#editState?.type === "edit") {
          const { state, dispatch } = this.view;
          const pos = this.#editState.pos;
          const node = state.doc.nodeAt(pos);
          if (node) {
            dispatch(state.tr.delete(pos, pos + node.nodeSize));
          }
        }
        this.#editState = null;
        this.provider.hide();
        this.view.focus();
        return;
      }
    }

    // Slash commands (via data-cmd)
    if (!cmdStr) return;
    const cmd = Number(cmdStr.replace(SLASH_CMD_PREFIX, "")) as SlashCommand;

    // Handle slash image command: show picker instead of inserting empty block
    if (cmd === SlashCommand.Image) {
      const { $from } = view.state.selection;
      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 500),
        $from.parentOffset,
      );
      const slashPos = textBefore.lastIndexOf("/");
      this.#imageSlashStart =
        slashPos >= 0 ? $from.pos - ($from.parentOffset - slashPos) : -1;
      this.#editState = { type: "create" };
      this.#programmaticActive = true;
      this.#programmaticPos = $from.pos;
      this.renderImagePicker();
      return;
    }

    if (cmd === SlashCommand.Video) {
      const { $from } = view.state.selection;
      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 500),
        $from.parentOffset,
      );
      const slashPos = textBefore.lastIndexOf("/");
      if (slashPos >= 0) {
        const deleteFrom = $from.pos - ($from.parentOffset - slashPos);
        view.dispatch(view.state.tr.delete(deleteFrom, $from.pos));
      }
      const { state } = view;
      const { $from: afterDel } = state.selection;
      const blockStart = afterDel.before(afterDel.depth);
      const blockEnd = afterDel.end(afterDel.depth);
      const videoNode = state.schema.nodes.video?.create(defaultVideoAttrs);
      if (videoNode) {
        const tr = state.tr.replaceWith(blockStart, blockEnd, videoNode);
        view.dispatch(tr.scrollIntoView());
        view.dom.dispatchEvent(new CustomEvent("inb4doc:edit-video", {
          bubbles: true,
          detail: { pos: blockStart, attrs: { ...defaultVideoAttrs } },
        }));
      }
      view.focus();
      return;
    }

    const { selection } = view.state;
    const { $from } = selection;
    const textBefore = $from.parent.textBetween(
      Math.max(0, $from.parentOffset - 500),
      $from.parentOffset,
    );
    const slashPos = textBefore.lastIndexOf("/");
    if (slashPos >= 0) {
      const deleteFrom = $from.pos - ($from.parentOffset - slashPos);
      view.dispatch(view.state.tr.delete(deleteFrom, $from.pos));
    }

    // Everything past the "/text" deletion is shared with the insert menus
    // (mobile FAB "+" / desktop block-handle "+"): same special cases for
    // empty blocks in lists/headings, divider, and wrap/list/code/table
    // commands. Image/Video keep their in-content picker/dialog paths above.
    executeInsertCommand(this.milkdownCtx, cmd, level);
  }

  private openImageEditor(pos: number, src: string) {
    this.#editState = { type: "edit", pos, src };
    this.renderImagePicker();
    const { state, dispatch } = this.view;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
    dispatch(tr);
  }

  private openVideoEditor(pos: number, attrs: VideoDialogResult) {
    const view = this.view;

    openVideoDialog(
      attrs,
      (result) => {
        const { state, dispatch } = view;
        const node = state.doc.nodeAt(pos);
        if (node) {
          dispatch(
            state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...result }),
          );
        }
        view.focus();
      },
      () => {
        const { state, dispatch } = view;
        const tr = state.tr.delete(pos, pos + (state.doc.nodeAt(pos)?.nodeSize ?? 0));
        dispatch(tr);
        view.focus();
      },
    );
  }

  private renderImagePicker() {
    const editState = this.#editState;
    const currentSrc = editState?.type === "edit" ? editState.src : "";
    const html = `
      <div class="slash-image-picker">
        <div class="slash-image-suggestions" data-area="suggestions">
          <div class="slash-image-empty">Loading\u2026</div>
        </div>
        <div class="slash-url-row">
          <input class="slash-url-input" type="text" placeholder="Paste image URL\u2026" value="${currentSrc}">
          <button class="slash-url-btn" data-img-action="${IMG_ACTION_PREFIX}${ImageAction.UrlSubmit}">OK</button>
          <button class="slash-url-btn slash-cancel-btn" data-img-action="${IMG_ACTION_PREFIX}${ImageAction.Cancel}">Cancel</button>
          ${editState?.type === "edit" ? `<button class="slash-url-btn slash-remove-btn" data-img-action="${IMG_ACTION_PREFIX}${ImageAction.Remove}">Remove</button>` : ""}
        </div>
        <div class="slash-upload-row">
          <label class="slash-upload-label">
            Upload from computer
            <input type="file" accept="image/*" class="slash-upload-input" hidden>
          </label>
        </div>
      </div>
    `;
    this.content.innerHTML = html;
    this.#imageMode = true;
    const es = this.#editState;
    const pos =
      es?.type === "edit"
        ? es.pos
        : this.#imageSlashStart >= 0
          ? this.#imageSlashStart
          : this.view.state.selection.from;
    this.#programmaticPos = pos;
    this.#programmaticActive = true;

    const coords = this.view.coordsAtPos(pos);
    if (coords) {
      this.content.style.left = `${coords.left}px`;
      this.content.style.top = `${coords.bottom + 4}px`;
    }
    this.provider.show();

    const uploadInput = this.content.querySelector(
      ".slash-upload-input",
    ) as HTMLInputElement;
    if (uploadInput) {
      uploadInput.addEventListener("change", () => {
        const file = uploadInput.files?.[0];
        if (file) this.triggerImageUpload(file);
      });
    }

    const urlInput = this.content.querySelector(
      ".slash-url-input",
    ) as HTMLInputElement;
    if (urlInput) {
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.confirmImageUrl(urlInput.value.trim());
        }
      });
      urlInput.focus();
      urlInput.select();
    }

    imageService.listImages()
      .catch(() => {})
      .then(() => {
        this.renderImageSuggestions();
      });
  }

  private renderImageSuggestions() {
    const el = this.content.querySelector("[data-area='suggestions']");
    if (!el) return;
    const allImages = imageService.getAllImages();
    el.innerHTML =
      allImages
        .slice(0, 3)
        .map(
          (img) => `
      <div class="slash-image-item" data-img-action="${IMG_ACTION_PREFIX}${ImageAction.Select}" data-url="${img.url}">
        <img src="${img.url}" />
        <span>${img.name}</span>
        ${img.pending ? '<span class="slash-image-pending">(pending)</span>' : ""}
      </div>
    `,
        )
        .join("") || '<div class="slash-image-empty">No images yet</div>';
  }

  private confirmImageUrl(url: string) {
    const view = this.view;
    const { state, dispatch } = view;

    if (this.#editState?.type === "edit") {
      const pos = this.#editState.pos;
      const node = state.doc.nodeAt(pos);
      if (node) {
        dispatch(
          state.tr.setNodeMarkup(pos, null, { ...node.attrs, src: url }),
        );
      }
      this.#editState = null;
      this.provider.hide();
      view.focus();
      return;
    }

    const img = state.schema.nodes["image-block"]?.create({
      src: url,
      caption: "",
      ratio: 1,
    });
    const para = state.schema.nodes.paragraph.create();
    if (!img) return;

    let tr = state.tr;
    if (this.#imageSlashStart >= 0) {
      const currentPos = state.selection.$from.pos;
      tr = tr.delete(this.#imageSlashStart, currentPos);
    }

    const { $from } = tr.selection;
    const depth = $from.depth;
    const pos = depth > 0 ? $from.before(depth) : $from.pos;
    const blockSize = depth > 0 ? $from.node(depth).nodeSize : 0;
    tr = tr.replaceWith(pos, pos + blockSize, [img, para]);
    tr = tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());

    this.#editState = null;
    this.#imageSlashStart = -1;
    this.provider.hide();
    view.focus();
  }

  private triggerImageUpload(file: File) {
    imageService.uploadImage(file).then((url) => {
      this.confirmImageUrl(url);
    });
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background = i === this.activeIndex ? "var(--color-bg-tertiary)" : "";
    }
  }
}

export function configureBlockEdit(ctx: Ctx) {
  // The dock layout (gui-mobile always, web builds on a mobile viewport) has no
  // hover affordance: the block handle is disabled and the FAB "+" is the insert
  // entry point. Desktop keeps the hover block handle.
  if (!isMobileDock()) {
    ctx.set(block.key, {
      view: () => new BlockHandleView(ctx),
    });
  }
  ctx.update(blockConfig.key, (prev) => ({
    ...prev,
    filterNodes: (pos) => {
      if (isMobileDock()) return false;
      for (let d = pos.depth; d > 0; d--) {
        const node = pos.node(d);
        const typeName = proseNodeTypeByName.get(node.type.name);
        if (typeName === ProseNodeType.Table || typeName === ProseNodeType.Blockquote)
          return false;
      }
      return true;
    },
  }));
  ctx.set(slash.key, { view: (v: any) => new SlashView(v, ctx) });
}

export { block, slash, menuAPI };
