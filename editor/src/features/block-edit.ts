import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { editorViewCtx, commandsCtx } from "@milkdown/kit/core";
import { block, BlockProvider, blockConfig } from "@milkdown/kit/plugin/block";
import { slashFactory, SlashProvider } from "@milkdown/kit/plugin/slash";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";
import {
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import type { Node } from "@milkdown/kit/prose/model";
import { menuAPI, type MenuAPI } from "./menu-api";
import {
  plusIcon,
  menuIcon,
  h1Icon,
  h2Icon,
  h3Icon,
  bulletListIcon,
  orderedListIcon,
  quoteIcon,
  dividerIcon,
  codeBlockIcon,
  mathIcon,
  tableIcon,
  todoListIcon,
  imageIcon,
} from "../components/icons";
import { getAllImages, uploadImage, listImages } from "../services/image-config";

const slash = slashFactory("predoc");

type SlashItem = { cmd: string; label: string; icon: string; level?: number };
const SLASH_ITEMS: SlashItem[] = [
  { cmd: "heading", label: "Heading 1", icon: h1Icon, level: 1 },
  { cmd: "heading", label: "Heading 2", icon: h2Icon, level: 2 },
  { cmd: "heading", label: "Heading 3", icon: h3Icon, level: 3 },
  { cmd: "bullet_list", label: "Bullet List", icon: bulletListIcon },
  { cmd: "ordered_list", label: "Ordered List", icon: orderedListIcon },
  { cmd: "todo_list", label: "Task List", icon: todoListIcon },
  { cmd: "blockquote", label: "Blockquote", icon: quoteIcon },
  { cmd: "thematic_break", label: "Divider", icon: dividerIcon },
  { cmd: "code_block", label: "Code Block", icon: codeBlockIcon },
  { cmd: "math_block", label: "Math Block (LaTeX)", icon: mathIcon },
  { cmd: "table", label: "Table", icon: tableIcon },
  { cmd: "image", label: "Image", icon: imageIcon },
];

class BlockHandleView {
  #content: HTMLElement;
  #provider: BlockProvider;
  #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    const content = document.createElement("div");
    content.className = "milkdown-block-handle";
    content.innerHTML = `
      <button class="block-handle-add" title="Add paragraph below">${plusIcon}</button>
      <button class="block-handle-drag" title="Drag to move">${menuIcon}</button>
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
      getOffset: () => 16,
      getPlacement: ({ active, blockDom }) => {
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
      getPosition: ({ active, editorDom }) => {
        const editorRect = editorDom.getBoundingClientRect();
        const domRect = active.el.getBoundingClientRect();
        const style = window.getComputedStyle(active.el);
        const paddingTop = Number.parseInt(style.paddingTop, 10) || 0;
        const paddingBottom = Number.parseInt(style.paddingBottom, 10) || 0;
        return {
          x: editorRect.x,
          y: domRect.y + paddingTop,
          width: 0,
          height: domRect.height - paddingTop - paddingBottom,
          top: domRect.y + paddingTop,
          left: editorRect.x + 32,
          bottom: domRect.y + domRect.height - paddingBottom,
          right: editorRect.x,
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
    (ctx.get(menuAPI.key) as any).show(tr.selection.from);
  };
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
  #editState: { type: "create" } | { type: "edit"; pos: number; src: string } | null = null;
  #imageMode = false;

  constructor(view: EditorView, ctx: Ctx) {
    this.view = view;
    this.milkdownCtx = ctx;
    this.content = document.createElement("div");
    this.content.className = "milkdown-slash";
    this.content.dataset.show = "false";

    this.content.addEventListener("pointerdown", (e) => {
      const item = (e.target as HTMLElement).closest(
        "[data-cmd]",
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
    view.dom.addEventListener("predoc:edit-image", ((e: CustomEvent) => {
      const { pos, src } = e.detail;
      this.openImageEditor(pos, src);
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
          ["paragraph", "heading"].includes(node.type.name),
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
          `<div data-cmd="${it.cmd}" data-level="${it.level ?? ""}" class="slash-item">
            <span class="slash-icon">${it.icon}</span>
            <span class="slash-label">${it.label}</span>
          </div>`,
      )
      .join("");
  }

  private execute(item: HTMLElement) {
    const cmd = item.dataset.cmd!;
    const level = parseInt(item.dataset.level || "0");
    const view = this.view;
    const isProgrammatic = this.#programmaticActive;
    this.#programmaticActive = false;

    // Image picker commands
    if (cmd === "image-select") {
      const url = item.dataset.url || "";
      if (url) this.confirmImageUrl(url);
      return;
    }
    if (cmd === "image-url-submit") {
      const input = this.content.querySelector(".slash-url-input") as HTMLInputElement;
      const url = input?.value.trim() || "";
      if (url) this.confirmImageUrl(url);
      return;
    }
    if (cmd === "image-cancel") {
      this.#editState = null;
      this.provider.hide();
      this.view.focus();
      return;
    }
    if (cmd === "image-remove") {
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

    // Handle slash image command: show picker instead of inserting empty block
    if (cmd === "image") {
      const { $from } = view.state.selection;
      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 500),
        $from.parentOffset,
      );
      const slashPos = textBefore.lastIndexOf("/");
      this.#imageSlashStart = slashPos >= 0 ? $from.pos - ($from.parentOffset - slashPos) : -1;
      this.#editState = { type: "create" };
      this.#programmaticActive = true;
      this.#programmaticPos = $from.pos;
      this.renderImagePicker();
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

    const { state } = view;
    const { schema } = state;
    const { $from: afterDel } = view.state.selection;

    if (afterDel.parent.content.size === 0) {
      let parentType: string | null = null;
      let parentDepth = 0;
      for (let d = afterDel.depth; d > 0; d--) {
        const node = afterDel.node(d);
        if (
          node.type === schema.nodes.bullet_list ||
          node.type === schema.nodes.ordered_list ||
          node.type === schema.nodes.blockquote
        ) {
          parentType = node.type.name;
          parentDepth = d;
          break;
        }
      }
      const isHeading = afterDel.parent.type === schema.nodes.heading;
      if (parentType || isHeading) {
        this.replaceBlock(cmd, level, view, parentType, parentDepth, isHeading);
        return;
      }
    }

    if (cmd === "thematic_break") {
      this.insertDivider(view);
      view.focus();
      return;
    }

    const commands = this.milkdownCtx.get(commandsCtx);
    if (cmd === "heading") commands.call(wrapInHeadingCommand.key, level);
    else if (cmd === "bullet_list") commands.call(wrapInBulletListCommand.key);
    else if (cmd === "ordered_list")
      commands.call(wrapInOrderedListCommand.key);
    else if (cmd === "blockquote") commands.call(wrapInBlockquoteCommand.key);
    else if (cmd === "todo_list") this.convertToTodoList(view);
    else if (cmd === "code_block") this.convertToCodeBlock(view);
    else if (cmd === "math_block") this.convertToMathBlock(view);
    else if (cmd === "table") this.insertTable(view);
    view.focus();
  }

  private replaceBlock(
    cmd: string,
    level: number,
    view: EditorView,
    parentType: string | null,
    parentDepth: number,
    isHeading: boolean,
  ) {
    const { state, dispatch } = view;
    const { schema } = state;
    const { $from } = state.selection;

    if (cmd === "thematic_break" || cmd === "image") {
      this.insertBelow(cmd, level, view);
      return;
    }
    if (parentType === "bullet_list" && cmd === "ordered_list") {
      const pos = $from.before(parentDepth);
      const node = $from.node(parentDepth);
      dispatch(
        state.tr.replaceWith(
          pos,
          pos + node.nodeSize,
          schema.nodes.ordered_list.create(null, node.content),
        ),
      );
      return;
    }
    if (parentType === "ordered_list" && cmd === "bullet_list") {
      const pos = $from.before(parentDepth);
      const node = $from.node(parentDepth);
      dispatch(
        state.tr.replaceWith(
          pos,
          pos + node.nodeSize,
          schema.nodes.bullet_list.create(null, node.content),
        ),
      );
      return;
    }
    if (parentType === "blockquote" && cmd === "blockquote") return;

    if (cmd === "heading") {
      const heading = schema.nodes.heading.create({ level });
      const pos = parentType
        ? $from.before(parentDepth)
        : $from.before($from.depth);
      dispatch(
        state.tr.replaceWith(
          pos,
          pos +
            (parentType ? $from.node(parentDepth) : $from.node($from.depth))
              .nodeSize,
          heading,
        ),
      );
      return;
    }

    const pos =
      isHeading || parentType
        ? $from.before(parentType ? parentDepth : $from.depth)
        : $from.before($from.depth);
    const block = parentType
      ? $from.node(parentType ? parentDepth : $from.depth)
      : $from.node($from.depth);
    const para = schema.nodes.paragraph.create();
    let newBlock: Node;
    if (cmd === "bullet_list")
      newBlock = schema.nodes.bullet_list.create(
        null,
        schema.nodes.list_item.create(null, para),
      );
    else if (cmd === "ordered_list")
      newBlock = schema.nodes.ordered_list.create(
        null,
        schema.nodes.list_item.create(null, para),
      );
    else newBlock = schema.nodes.blockquote.create(null, para);
    dispatch(state.tr.replaceWith(pos, pos + block.nodeSize, newBlock));
  }

  private insertBelow(cmd: string, level: number, view: EditorView) {
    const { state, dispatch } = view;
    const { schema } = state;
    const { $from } = state.selection;
    const afterPos = $from.after($from.depth);
    if (cmd === "heading") {
      const heading = schema.nodes.heading.create({ level });
      const tr = state.tr.insert(afterPos, heading);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 1)));
      return;
    }
    if (cmd === "thematic_break") {
      const hr = schema.nodes.hr.create();
      const para = schema.nodes.paragraph.create();
      const tr = state.tr.insert(afterPos, hr).insert(afterPos + 2, para);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 3)));
      return;
    }
    if (cmd === "image") {
      const img = schema.nodes["image-block"]?.create({ src: "", caption: "", ratio: 1 });
      const para = schema.nodes.paragraph.create();
      if (img) {
        const tr = state.tr.insert(afterPos, img).insert(afterPos + 2, para);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, afterPos + 3)));
      }
      return;
    }
    const para = schema.nodes.paragraph.create();
    let newBlock: Node;
    if (cmd === "bullet_list")
      newBlock = schema.nodes.bullet_list.create(
        null,
        schema.nodes.list_item.create(null, para),
      );
    else if (cmd === "ordered_list")
      newBlock = schema.nodes.ordered_list.create(
        null,
        schema.nodes.list_item.create(null, para),
      );
    else newBlock = schema.nodes.blockquote.create(null, para);
    const tr = state.tr.insert(afterPos, newBlock);
    const selPos = cmd === "blockquote" ? afterPos + 2 : afterPos + 3;
    dispatch(tr.setSelection(TextSelection.create(tr.doc, selPos)));
  }

  private insertDivider(view: EditorView) {
    const { state, dispatch } = view;
    const { schema } = state;
    const { $from } = state.selection;

    const pos = $from.before($from.depth);
    const blockSize = $from.node($from.depth).nodeSize;
    const hr = schema.nodes.hr.create();
    const para = schema.nodes.paragraph.create();
    const tr = state.tr.replaceWith(pos, pos + blockSize, [hr, para]);
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView(),
    );
  }

  private insertImage(view: EditorView) {
    this.#editState = { type: "create" };
    this.renderImagePicker();
  }

  private openImageEditor(pos: number, src: string) {
    this.#editState = { type: "edit", pos, src };
    this.renderImagePicker();
    const { state, dispatch } = this.view;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
    dispatch(tr);
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
          <button class="slash-url-btn" data-cmd="image-url-submit">OK</button>
          <button class="slash-url-btn slash-cancel-btn" data-cmd="image-cancel">Cancel</button>
          ${editState?.type === "edit" ? '<button class="slash-url-btn slash-remove-btn" data-cmd="image-remove">Remove</button>' : ''}
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
    const pos = es?.type === "edit"
      ? es.pos
      : (this.#imageSlashStart >= 0 ? this.#imageSlashStart : this.view.state.selection.from);
    this.#programmaticPos = pos;
    this.#programmaticActive = true;

    const coords = this.view.coordsAtPos(pos);
    if (coords) {
      this.content.style.left = `${coords.left}px`;
      this.content.style.top = `${coords.bottom + 4}px`;
    }
    this.provider.show();

    const uploadInput = this.content.querySelector(".slash-upload-input") as HTMLInputElement;
    if (uploadInput) {
      uploadInput.addEventListener("change", () => {
        const file = uploadInput.files?.[0];
        if (file) this.triggerImageUpload(file);
      });
    }

    const urlInput = this.content.querySelector(".slash-url-input") as HTMLInputElement;
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

    listImages().catch(() => {}).then(() => {
      this.renderImageSuggestions();
    });
  }

  private renderImageSuggestions() {
    const el = this.content.querySelector("[data-area='suggestions']");
    if (!el) return;
    const allImages = getAllImages();
    el.innerHTML = allImages.slice(0, 3).map(img => `
      <div class="slash-image-item" data-cmd="image-select" data-url="${img.url}">
        <img src="${img.url}" />
        <span>${img.name}</span>
        ${img.pending ? '<span class="slash-image-pending">(pending)</span>' : ''}
      </div>
    `).join('') || '<div class="slash-image-empty">No images yet</div>';
  }

  private confirmImageUrl(url: string) {
    const view = this.view;
    const { state, dispatch } = view;

    if (this.#editState?.type === "edit") {
      const pos = this.#editState.pos;
      const node = state.doc.nodeAt(pos);
      if (node) {
        dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, src: url }));
      }
      this.#editState = null;
      this.provider.hide();
      view.focus();
      return;
    }

    const img = state.schema.nodes["image-block"]?.create({ src: url, caption: "", ratio: 1 });
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
    uploadImage(file).then((url) => {
      this.confirmImageUrl(url);
    });
  }

  private convertToTodoList(view: EditorView) {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const para = state.schema.nodes.paragraph.create();
    const listItem = state.schema.nodes.list_item.create(
      { checked: false },
      para,
    );
    const bulletList = state.schema.nodes.bullet_list.create(null, listItem);
    const pos = $from.before($from.depth);
    dispatch(
      state.tr
        .replaceWith(pos, pos + $from.node($from.depth).nodeSize, bulletList)
        .scrollIntoView(),
    );
  }

  private convertToCodeBlock(view: EditorView) {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const codeBlock = state.schema.nodes.code_block.create({ language: "" });
    const pos = $from.before($from.depth);
    const tr = state.tr
      .replaceWith(pos, pos + $from.node($from.depth).nodeSize, codeBlock);
    dispatch(
      tr
        .setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
        .scrollIntoView(),
    );
  }

  private convertToMathBlock(view: EditorView) {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const codeBlock = state.schema.nodes.code_block.create({ language: "LaTeX" });
    const pos = $from.before($from.depth);
    const tr = state.tr
      .replaceWith(pos, pos + $from.node($from.depth).nodeSize, codeBlock);
    dispatch(
      tr
        .setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
        .scrollIntoView(),
    );
  }

  private insertTable(view: EditorView) {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const pos = $from.before($from.depth);
    const tbl = createTable(this.milkdownCtx, 3, 3);
    dispatch(
      state.tr
        .replaceWith(pos, pos + $from.node($from.depth).nodeSize, tbl)
        .scrollIntoView(),
    );
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background = i === this.activeIndex ? "#e5e9f0" : "";
    }
  }
}

export function configureBlockEdit(ctx: Ctx) {
  ctx.set(block.key, {
    view: () => new BlockHandleView(ctx),
  });
  ctx.update(blockConfig.key, (prev) => ({
    ...prev,
    filterNodes: (pos) => {
      for (let d = pos.depth; d > 0; d--) {
        const node = pos.node(d);
        if (node.type.name === "table" || node.type.name === "blockquote")
          return false;
      }
      return true;
    },
  }));
  ctx.set(slash.key, { view: (v: any) => new SlashView(v, ctx) });
}

export { block, slash, menuAPI };
