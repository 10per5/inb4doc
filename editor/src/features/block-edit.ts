import type { EditorView } from "prosemirror-view"
import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state"
import { Menu } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { isMobileDock } from "@/utils/mobile";
import { executeInsertCommand } from "@/features/insert-command";
import { menuAPI } from "@/features/menu-api";
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
import { openVideoDialog, type VideoDialogAttrs } from "@/controllers/dialog/video-dialog.type";
import { openImageDialog } from "@/controllers/dialog/image-dialog.type";
import {
  SlashCommand, SLASH_CMD_PREFIX,
  ProseNodeType, proseNodeTypeByName,
} from "@/config/enums";

// ── View-factory maps (populated by configureBlockEdit, read by plugin views) ──

type BlockViewFactory = (view: EditorView) => { update: () => void; destroy: () => void }
type SlashViewFactory = (view: EditorView) => { update: (v: EditorView, s?: EditorState) => void; destroy: () => void }

const blockViewFactories = new Map<string, BlockViewFactory>()
const slashViewFactories = new Map<string, SlashViewFactory>()

// ── Slash items ──

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

// ── BlockHandleView ──

class BlockHandleView {
  #view: EditorView;
  #content: HTMLElement;
  #menu: Menu | null = null;
  #menuAnchor: HTMLElement | null = null;
  #activeEl: Element | null = null;
  #activeBlockStart: number = 0;

  constructor(view: EditorView) {
    this.#view = view;
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
    (view.dom.parentNode as Element)?.appendChild(content);
    content.style.display = "none";
    this.#updatePosition();
  }

  update = () => {
    this.#updatePosition();
  };

  destroy = () => {
    this.#content.remove();
    this.#menu?.destroy();
    this.#menuAnchor?.remove();
  };

  #updatePosition = () => {
    const { selection } = this.#view.state;
    const $from = selection.$from;

    if (isMobileDock()) {
      this.#content.style.display = "none";
      this.#activeEl = null;
      return;
    }

    const isAtBlockStart =
      $from.depth === 1 &&
      $from.parent.content.size === 0 &&
      $from.parent.type.name === "paragraph" &&
      $from.node(1).type.name !== "table_cell" &&
      $from.node(1).type.name !== "table_header";

    if (!isAtBlockStart) {
      this.#content.style.display = "none";
      this.#activeEl = null;
      return;
    }

    const blockStart = $from.before(1);
    const { node: domNode } = this.#view.domAtPos(blockStart, 0);
    const el = domNode.nodeType === Node.ELEMENT_NODE
      ? domNode as HTMLElement
      : (domNode.parentElement as HTMLElement | null);
    if (!el) {
      this.#content.style.display = "none";
      return;
    }

    const domRect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const paddingTop = Number.parseInt(style.paddingTop, 10) || 10;
    const paddingBottom = Number.parseInt(style.paddingBottom, 10) || 0;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const w = window.innerWidth;

    this.#content.style.display = "";
    this.#activeEl = el;
    this.#activeBlockStart = blockStart;

    let left: number;
    if (w >= 1350) {
      const prose = document.querySelector("#editor-area .ProseMirror");
      const proseRect = prose?.getBoundingClientRect();
      left = proseRect ? proseRect.left + Math.round(2 * rem) : domRect.left;
    } else if (w >= 800) {
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
      left = panelRight !== null
        ? panelRight + Math.round(4.25 * rem)
        : domRect.left;
    } else {
      left = domRect.right + Math.round(1.25 * rem);
    }

    const top = domRect.y + paddingTop;
    this.#content.style.left = `${left}px`;
    this.#content.style.top = `${top}px`;
  };

  private onAdd = () => {
    const view = this.#view;
    if (!view.hasFocus()) view.focus();
    if (this.#activeBlockStart <= 0) return;
    const pos = this.#activeBlockStart + this.#view.state.doc.resolve(this.#activeBlockStart).node().nodeSize;
    const tr = view.state.tr.insert(pos, view.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    view.dispatch(tr.scrollIntoView());
    this.#content.style.display = "none";
    this.openAddMenu();
  };

  private openAddMenu() {
    if (!this.#menu) {
      const anchor = document.createElement("div");
      anchor.className = "block-handle-menu-anchor";
      document.body.appendChild(anchor);
      this.#menuAnchor = anchor;
      this.#menu = new Menu({
        mountEl: anchor,
        triggerEl: this.#content.querySelector(".block-handle-add") as HTMLElement,
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

// ── SlashView ──

class SlashView {
  content: HTMLElement;
  private view: EditorView;
  private activeIndex = 0;
  private filterText = "";
  #programmaticPos: number | null = null;
  #programmaticActive = false;
  #visible = false;
  #handleKeydown: (e: KeyboardEvent) => void;
  #editImageHandler: ((e: Event) => void);
  #editVideoHandler: ((e: Event) => void);

  constructor(view: EditorView) {
    this.view = view;
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

    this.#handleKeydown = (e: KeyboardEvent) => {
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
        this.hide();
      }
    };

    this.#editImageHandler = ((e: CustomEvent) => {
      const { pos, src, attrs } = e.detail;
      openImageDialog({ mode: "edit", pos, src, attrs: attrs ?? {} }).then(
        (result) => {
          if (result == null) return;
          const { state, dispatch } = this.view;
          const node = state.doc.nodeAt(pos);
          if (!node) return;
          if (result.action === "remove") {
            dispatch(state.tr.delete(pos, pos + node.nodeSize));
          } else {
            const a = node.attrs as Record<string, unknown>;
            const next: Record<string, unknown> = { ...a, src: result.src };
            if ("caption" in a) next.caption = result.caption;
            else {
              next.alt = result.alt;
              next.title = result.caption;
            }
            dispatch(state.tr.setNodeMarkup(pos, null, next));
          }
          this.view.focus();
        },
      );
    }) as EventListener;

    this.#editVideoHandler = ((e: CustomEvent) => {
      const { pos, attrs } = e.detail;
      this.openVideoEditor(pos, attrs);
    }) as EventListener;

    view.dom.addEventListener("inb4doc:edit-image", this.#editImageHandler);
    view.dom.addEventListener("inb4doc:edit-video", this.#editVideoHandler);
    document.addEventListener("keydown", this.#handleKeydown, true);

    menuAPI.set(view, {
      show: (pos: number) => this.showAt(pos),
      hide: () => this.hide(),
    });
  }

  update(view: EditorView, prevState?: EditorState) {
    this.view = view;
    if (this.#programmaticActive) {
      this.#updateProgrammaticPosition();
      return;
    }
    this.#detectAndShow(view);
  }

  destroy() {
    document.removeEventListener("keydown", this.#handleKeydown, true);
    this.view.dom.removeEventListener("inb4doc:edit-image", this.#editImageHandler);
    this.view.dom.removeEventListener("inb4doc:edit-video", this.#editVideoHandler);
    this.hide();
  }

  show() {
    this.#visible = true;
    this.content.dataset.show = "true";
    this.activeIndex = 0;
    const domItems = this.content.querySelectorAll<HTMLElement>("[data-cmd]");
    this.highlight(domItems);
  }

  hide() {
    this.#visible = false;
    this.#programmaticActive = false;
    this.#programmaticPos = null;
    this.content.dataset.show = "false";
  }

  private showAt(pos: number) {
    this.filterText = "";
    this.renderItems();
    this.#programmaticPos = pos;
    this.#programmaticActive = true;
    this.show();
  }

  #updateProgrammaticPosition() {
    if (typeof this.#programmaticPos !== "number") return;
    const maxSize = this.view.state.doc.nodeSize - 2;
    const validPos = Math.min(this.#programmaticPos, maxSize);
    if (
      this.view.state.doc.resolve(validPos).node() !==
      this.view.state.doc.resolve(this.view.state.selection.from).node()
    ) {
      this.hide();
      return;
    }
    this.#programmaticPos = null;
    this.filterText = "";
    this.renderItems();
    this.#positionMenu();
  }

  #detectAndShow(view: EditorView) {
    const { selection } = view.state;
    const $from = selection.$from;
    if ($from.parent.type.name !== "paragraph" && $from.parent.type.name !== "heading") {
      this.hide();
      return;
    }
    const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
    if (!text.startsWith("/")) {
      this.hide();
      return;
    }
    this.filterText = text.slice(1);
    this.renderItems();
    if (!this.#visible) this.show();
    this.#positionMenu();
  }

  #positionMenu() {
    const { selection } = this.view.state;
    const coords = this.view.coordsAtPos(selection.from);
    const parent = this.content.parentElement;
    if (parent) {
      this.content.style.left = `${coords.left}px`;
      this.content.style.top = `${coords.bottom + 4}px`;
    }
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
    const cmdStr = item.dataset.cmd;
    const level = parseInt(item.dataset.level || "0");
    const view = this.view;
    const isProgrammatic = this.#programmaticActive;
    this.#programmaticActive = false;

    if (!cmdStr) return;
    const cmd = Number(cmdStr.replace(SLASH_CMD_PREFIX, "")) as SlashCommand;

    if (cmd === SlashCommand.Image) {
      const { $from } = view.state.selection;
      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 500),
        $from.parentOffset,
      );
      const slashPos = textBefore.lastIndexOf("/");
      const deleteFrom =
        slashPos >= 0 ? $from.pos - ($from.parentOffset - slashPos) : -1;
      if (deleteFrom >= 0) {
        view.dispatch(view.state.tr.delete(deleteFrom, $from.pos));
      }
      const { state } = view;
      const { $from: afterDel } = state.selection;
      const blockStart = afterDel.before(afterDel.depth);
      const blockEnd = afterDel.end(afterDel.depth);
      const imageNode = state.schema.nodes["image-block"]?.create();
      if (imageNode) {
        const tr = state.tr.replaceWith(blockStart, blockEnd, imageNode);
        view.dispatch(tr.scrollIntoView());
        openImageDialog({
          mode: "create",
          pos: blockStart,
          src: "",
          attrs: { ...imageNode.attrs },
        }).then((result) => {
          if (result == null || result.action !== "save") return;
          const { state: s, dispatch: d } = this.view;
          const node = s.doc.nodeAt(blockStart);
          if (!node) return;
          d(
            s.tr.setNodeMarkup(blockStart, null, {
              ...(node.attrs as Record<string, unknown>),
              src: result.src,
              caption: result.caption,
            }),
          );
          this.view.focus();
        });
      }
      view.focus();
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

    executeInsertCommand(this.view, cmd, level);
  }

  private openVideoEditor(pos: number, attrs: VideoDialogAttrs) {
    const view = this.view;

    openVideoDialog(attrs).then((result) => {
      if (result == null) return;
      const { state, dispatch } = view;
      if (result.action === "remove") {
        const tr = state.tr.delete(pos, pos + (state.doc.nodeAt(pos)?.nodeSize ?? 0));
        dispatch(tr);
      } else {
        const node = state.doc.nodeAt(pos);
        if (node) {
          dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...result }));
        }
      }
      view.focus();
    });
  }

  private highlight(items: NodeListOf<HTMLElement>) {
    for (let i = 0; i < items.length; i++) {
      items[i].style.background = i === this.activeIndex ? "var(--color-bg-tertiary)" : "";
    }
  }
}

// ── Public API ──

export function configureBlockEdit(view: EditorView) {
  const blockKey = "inb4doc-block";
  const slashKey = "inb4doc-slash";

  if (!isMobileDock()) {
    blockViewFactories.set(blockKey, (v) => new BlockHandleView(v));
  }

  slashViewFactories.set(slashKey, (v) => new SlashView(v));
}

const block = new Plugin({
  key: new PluginKey("inb4doc-block"),
  view(view) {
    const factory = blockViewFactories.get("inb4doc-block");
    return factory ? factory(view) : { update: () => {}, destroy: () => {} };
  },
});

const slash = new Plugin({
  key: new PluginKey("inb4doc-slash"),
  view(view) {
    const factory = slashViewFactories.get("inb4doc-slash");
    return factory ? factory(view) : { update: () => {}, destroy: () => {} };
  },
});

export { block, slash, menuAPI };
