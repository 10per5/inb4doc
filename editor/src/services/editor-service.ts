/**
 * EditorService
 *
 * Manages Milkdown editor lifecycle, state, and configuration
 * Handles editor creation, content updates, and source/WYSIWYG mode switching
 */

import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  prosePluginsCtx,
} from "@milkdown/kit/core";
import { commonmark as _commonmark, wrapInHeadingInputRule } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { nord } from "@milkdown/theme-nord";
import { EditorState, NodeSelection, TextSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { parserCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/kit/plugin/history";
import {
  linkTooltipPlugin,
  configureLinkTooltip,
  linkTooltipConfig,
} from "@milkdown/kit/component/link-tooltip";
import { cursor, dropIndicatorConfig } from "@milkdown/kit/plugin/cursor";
import { $prose } from "@milkdown/kit/utils";
import { fixedHeadingInputRule } from "@/plugins/heading-input-rule";

const commonmark = _commonmark.filter(
  (p) => p !== wrapInHeadingInputRule,
);
import {
  tableBlock,
  tableBlockConfig,
} from "@milkdown/kit/component/table-block";
import {
  imageBlockComponent,
  imageBlockConfig,
} from "@milkdown/kit/component/image-block";
import { createKeymap } from "@/plugins/keyboard";
import {
  copyIcon,
  editIcon,
  removeIcon,
  confirmIcon,
} from "@/components/ui/icons";
import { alertRemarkPlugin, alertSchema } from "@/plugins/alert";
import { shortcodeDecoration } from "@/plugins/shortcode";
import { hugoRefSchema, initHugoRefClicks } from "@/plugins/hugo-ref";
import { MentionView } from "@/features/mention";
import {
  configureBlockEdit,
  block,
  slash,
  menuAPI,
} from "@/features/block-edit";
import {
  remarkMathPlugin,
  remarkMathBlockPlugin,
  mathInlineSchema,
  mathInlineInputRule,
  mathBlockInputRule,
  blockLatexSchema,
  toggleLatexCommand,
} from "@/plugins/math";
import { codeBlockUI } from "@/plugins/code-block-ui";
import { videoRemarkPlugin, videoSchema, videoView } from "@/plugins/video";
import { divCenterRemarkPlugin, divCenterSchema } from "@/plugins/div-center";
import { createDirtyPlugin } from "@/plugins/dirty";
import { createMentionPlugin } from "@/plugins/mention";
import { createImagePastePlugin } from "@/plugins/image-paste";
import { createLinkBoundaryPlugin } from "@/plugins/link-boundary";
import { createImageEditPlugin } from "@/plugins/image-edit";
import { cache } from "@/stores/cache";
import { toggleSourceMode, applySourceContent } from "@/features/editor-source";
import { getProvider } from "@/providers/provider-registry";
import { stripFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import { setCurrentDocDir, uploadImage } from "@/services/image-config";
import { imageRegistry } from "@/stores/image-registry";
import { findTextInProseMirror } from "@/features/search/prosemirror-search";
import { mountExternalChangeDialog } from "@/components/dialogs/external-change-dialog";

export interface EditorServiceConfig {
  onContentChange?: (content: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export class EditorService {
  private editor: Editor | null = null;
  private editorStates: Map<string, EditorState> = new Map();
  private lastSetContent: Map<string, string> = new Map();
  private mentionView: MentionView | null = null;
  private currentPath: string = "";
  private sourceMode: boolean = false;
  private config: EditorServiceConfig;

  constructor(config: EditorServiceConfig = {}) {
    this.config = config;
  }

  /**
   * Set current path context
   */
  setCurrentPath(path: string): void {
    const prev = this.currentPath;
    if (prev && prev !== path && this.editor) {
      this.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        this.editorStates.set(prev, view.state);
      });
    }
    this.currentPath = path;
    const dir = path.includes("/")
      ? path.substring(0, path.lastIndexOf("/"))
      : "";
    setCurrentDocDir(dir);
    getProvider().listImages?.(dir, false).catch(() => {});
  }

  /**
   * Get the directory portion of the current path
   */
  currentPathDir(): string {
    const dir = this.currentPath.includes("/")
      ? this.currentPath.substring(0, this.currentPath.lastIndexOf("/"))
      : "";
    return dir;
  }

  /**
   * Get current editor instance
   */
  getEditor(): Editor | null {
    return this.editor;
  }

  /**
   * Get mention view for page suggestions
   */
  getMentionView(): MentionView | null {
    return this.mentionView;
  }

  isSourceMode(): boolean {
    return this.sourceMode;
  }

  /**
   * Ensure editor exists and update content
   */
  ensureEditor(content: string): Promise<void> {
    if (!content || !content.trim()) {
      content = "# New Page\n\nStart writing...";
    }
    if (this.editor) {
      return Promise.resolve(this.updateEditorContent(content));
    }

    const editorEl = document.getElementById("milkdown-editor");
    if (!editorEl) throw new Error("Editor container not found");

    return this.createEditor(editorEl, content).then((e) => {
      this.editor = e;
    });
  }

  async fetchContent(
    path: string,
    onMetaUpdate?: (data: any) => void,
  ): Promise<string> {
    try {
      const provider = getProvider();
      const raw = await provider?.readFile(path);
      if (!raw) {
        const cachedBody = cache.getBody(path);
        if (cachedBody) {
          const fm = cache.getFrontmatter(path);
          if (fm) onMetaUpdate?.(fm);
          return cachedBody;
        }
        return "# New Page\n\nStart writing...";
      }

      const { frontmatter, body } = stripFrontmatter(raw);
      const serverTime = await provider?.getServerTime(path);
      const cachedTime = cache.getServerTime(path) || 0;

      const baseline = cache.getBaseline(path);
      if (baseline !== undefined && body !== baseline) {
        if (cache.isDirty(path)) {
          const localBody = cache.getBody(path) ?? body;
          const localFm = cache.getFrontmatter(path);
          const localFull = localFm
            ? `---\n${serializeFrontmatter(localFm)}\n---\n\n${localBody}`
            : localBody;

          const captured = {
            p: path,
            diskBody: body,
            diskFm: frontmatter,
            diskTime: serverTime ?? Date.now(),
            localBody,
            localFm,
            onMeta: onMetaUpdate,
          };

          mountExternalChangeDialog(path, localFull, raw).then((action) => {
            if (this.currentPath !== captured.p) return;
            if (action === "discard") {
              this.editorStates.delete(captured.p);
              cache.clearPath(captured.p);
              cache.setBaseline(captured.p, captured.diskBody);
              cache.setServerTime(captured.p, captured.diskTime);
              if (captured.diskFm) {
                cache.setFrontmatter(captured.p, captured.diskFm);
                captured.onMeta?.(captured.diskFm);
              }
              this.ensureEditor(captured.diskBody);
            } else {
              this.editorStates.delete(captured.p);
              cache.clearPath(captured.p);
              cache.setBaseline(captured.p, captured.diskBody);
              cache.setServerTime(captured.p, captured.diskTime);
              if (captured.localFm) {
                cache.setFrontmatter(captured.p, captured.localFm);
                captured.onMeta?.(captured.localFm);
              }
              cache.setBody(captured.p, captured.localBody);
              this.ensureEditor(captured.localBody);
            }
          });

          this.editorStates.delete(path);
          cache.setServerTime(path, serverTime ?? Date.now());
          if (frontmatter) onMetaUpdate?.(frontmatter);
          return body;
        } else {
          this.editorStates.delete(path);
          cache.clearPath(path);
          cache.setBaseline(path, body);
          cache.setServerTime(path, serverTime ?? Date.now());
          if (frontmatter) { cache.setFrontmatter(path, frontmatter); onMetaUpdate?.(frontmatter); }
          return body;
        }
      }

      if (serverTime && serverTime > cachedTime) {
        cache.clearPath(path);
        cache.setBaseline(path, body);
        cache.setServerTime(path, serverTime);
        if (frontmatter) onMetaUpdate?.(frontmatter);
        return body;
      }

      if (frontmatter) {
        if (cache.isDirty(path) && cache.getFrontmatter(path)) {
          onMetaUpdate?.(cache.getFrontmatter(path)!);
        } else {
          cache.setFrontmatter(path, frontmatter);
          onMetaUpdate?.(frontmatter);
        }
      } else {
        cache.removeFrontmatter(path);
        onMetaUpdate?.({ title: "" });
      }
      cache.setBaseline(path, body);
      return cache.getBody(path) ?? body;
    } catch {
      return "# New Page\n\nStart writing...";
    }
  }

  async loadContent(
    path: string,
    onMetaUpdate?: (data: any) => void,
  ): Promise<void> {
    const content = await this.fetchContent(path, onMetaUpdate);
    return this.ensureEditor(content);
  }

  /**
   * Update existing editor content
   */
  private updateEditorContent(content: string): void {
    if (!this.editor) return;

    const cached = this.editorStates.get(this.currentPath);
    if (cached) {
      this.lastSetContent.set(this.currentPath, "");
      this.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.updateState(cached);
      });
    } else {
      this.lastSetContent.set(this.currentPath, "");
      this.editor.action((ctx) => {
        const parser = ctx.get(parserCtx);
        const view = ctx.get(editorViewCtx);
        const doc = parser(content);
        const newState = EditorState.create({
          schema: view.state.schema,
          doc,
          plugins: view.state.plugins,
        });
        view.updateState(newState);
        this.editorStates.set(this.currentPath, newState);
      });
    }
  }

  /**
   * Create new Milkdown editor instance
   */
  private async createEditor(
    container: HTMLElement,
    content: string,
  ): Promise<Editor> {
    const self = this;

    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, container);
        ctx.set(defaultValueCtx, content);
        configureBlockEdit(ctx);

        ctx.update(dropIndicatorConfig.key, () => ({
          class: "predoc-drop-cursor",
          width: 4,
          color: false as const,
        }));

        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          handlers: {
            ...prev.handlers,
            text: (node: any, _: any, state: any, info: any) => {
              const value = node.value;
              if (!value) return "";
              if (/^[^*_\\]*\s+$/.test(value)) return value;
              if (value.includes("{{")) return value;
              return state.safe(value, { ...info, encode: [] });
            },
          },
        }));

        configureLinkTooltip(ctx);
        ctx.update(linkTooltipConfig.key, (prev) => ({
          ...prev,
          linkIcon: copyIcon,
          editButton: editIcon,
          removeButton: removeIcon,
          confirmButton: confirmIcon,
          inputPlaceholder: "Paste link...",
        }));

        ctx.update(tableBlockConfig.key, (prev) => ({
          ...prev,
          renderButton: (renderType) => {
            switch (renderType) {
              case "add_row":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Row`;
              case "add_col":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Col`;
              case "delete_row":
                return `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
              case "delete_col":
                return `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
              case "align_col_left":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z"/></svg>`;
              case "align_col_center":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"/></svg>`;
              case "align_col_right":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z"/></svg>`;
              case "col_drag_handle":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 15h18v-2H3v2zm0-4h18V9H3v2zm0-6v2h18V5H3zm0 12h18v-2H3v2z"/></svg>`;
              case "row_drag_handle":
                return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21 3H3v18h18V3zm-2 16H5V5h14v14zm-7-3h2V8h-2v8z"/></svg>`;
            }
          },
        }));

        ctx.update(imageBlockConfig.key, (prev) => ({
          ...prev,
          onUpload: uploadImage,
          proxyDomURL: (url: string) => {
            if (!url) return url;
            if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("blob:")) return url;
            if (url.startsWith("/uploads/")) return url;
            if (url.startsWith("predoc-image:")) {
              const name = url.slice("predoc-image:".length);
              return localStorage.getItem("predoc:image:" + name) || url;
            }
            if (url.startsWith("pending-image:")) {
              const blobUrl = imageRegistry.getBlobUrl(url.slice("pending-image:".length));
              if (blobUrl) return blobUrl;
            }
            const provider = getProvider();
            const resolved = provider.resolveImageUrl?.(url);
            if (resolved) return resolved;
            return `/uploads/${self.currentPathDir()}/${url}`;
          },
        }));

        ctx.update(prosePluginsCtx, (plugins) => {
          return plugins.concat(
            createDirtyPlugin(ctx, {
              lastSetContent: self.lastSetContent,
              getCurrentPath: () => self.currentPath,
              onDirtyChange: self.config.onDirtyChange,
            }),
            createMentionPlugin(ctx, (mv) => { self.mentionView = mv }),
            createImagePastePlugin({ uploadImage }),
            createLinkBoundaryPlugin(),
            createImageEditPlugin(),
            createKeymap(),
          );
        });
      })
      .use(nord as any)
      .use(commonmark)
      .use(fixedHeadingInputRule)
      .use(gfm)
      .use(block)
      .use(slash)
      .use(menuAPI)
      .use(history)
      .use(clipboard)
      .use(alertRemarkPlugin)
      .use(alertSchema)
      .use(hugoRefSchema)
      .use(shortcodeDecoration)
      .use(linkTooltipPlugin)
      .use(tableBlock)
      .use(imageBlockComponent)
      .use(codeBlockUI)
      .use(videoRemarkPlugin)
      .use(videoSchema)
      .use(videoView)
      .use(divCenterRemarkPlugin)
      .use(divCenterSchema)
      .use(cursor)
      .use(remarkMathPlugin)
      .use(remarkMathBlockPlugin)
      .use(mathInlineSchema)
      .use(mathInlineInputRule)
      .use(mathBlockInputRule)
      .use(blockLatexSchema)
      .use(toggleLatexCommand)
      .use(
        $prose(() => {
          const dragDropPlugin = new Plugin({
            key: new PluginKey("predoc-drag-drop"),
            props: {
              handleDOMEvents: {
                dragstart(view, event) {
                    if (view.dragging?.move) {
                        const { selection, doc } = view.state;
                        let from: number, to: number;
                        if (selection instanceof NodeSelection) {
                            from = selection.from;
                            to = selection.to;
                        } else {
                            const $from = doc.resolve(selection.from);
                            const depth = Math.max(1, $from.depth);
                            from = $from.before(depth);
                            to = from + $from.node(depth).nodeSize;
                        }

                        (view.dragging as any).node = {
                            replace: (tr: any) => {
                                const mappedFrom = tr.mapping.map(from);
                                const mappedTo = tr.mapping.map(to);
                                tr.delete(mappedFrom, mappedTo);
                            },
                        };
                    }
                    return false;
                },
              },
            },
          });
          return dragDropPlugin;
        }),
      )
      .create();

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      initHugoRefClicks(view);
    });

    return editor;
  }

  /**
   * Toggle between source and WYSIWYG mode
   */
  toggleSourceMode(): boolean {
    if (!this.editor) return this.sourceMode;

    const sourceEl = document.getElementById("source-editor");
    const wysiwygEl = document.getElementById("milkdown-editor");

    if (!sourceEl || !wysiwygEl) return this.sourceMode;

    this.sourceMode = toggleSourceMode(
      this.editor,
      sourceEl,
      wysiwygEl,
      this.sourceMode,
    );
    return this.sourceMode;
  }

  /**
   * Apply source editor content back to WYSIWYG
   */
  async applySourceContent(): Promise<void> {
    if (!this.editor) return;

    const textarea = document.querySelector(
      "#source-editor textarea",
    ) as HTMLTextAreaElement;
    if (!textarea) return;

    this.lastSetContent.set(this.currentPath, "");
    applySourceContent(this.editor, textarea);

    const md = this.editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      return serializer(ctx.get(editorViewCtx).state.doc)
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
    });

    cache.setBody(this.currentPath, md);
    this.sourceMode = false;

    const sourceEl = document.getElementById("source-editor");
    const wysiwygEl = document.getElementById("milkdown-editor");
    if (sourceEl && wysiwygEl) {
      sourceEl.style.display = "none";
      wysiwygEl.style.display = "block";
    }

    this.config.onContentChange?.(md);
  }

  /**
   * Get current editor content
   */
  getCurrentContent(): string {
    if (!this.editor) return "";

    return this.editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      return serializer(ctx.get(editorViewCtx).state.doc)
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
    });
  }

  /**
   * Save current editor state for path
   */
  saveState(path: string): void {
    if (!this.editor) return;

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      this.editorStates.set(path, view.state);
    });
  }

  /**
   * Clear saved states
   */
  clearStates(): void {
    this.editorStates.clear();
    this.lastSetContent.clear();
  }

  /**
   * Clear last set content for a path (resets dirty tracking)
   */
  clearLastSetContent(path: string): void {
    this.lastSetContent.set(path, "");
  }

  /**
   * Scroll to a match in the editor by walking .ProseMirror text nodes
   */
  scrollToText(query: string, matchIndex?: number, snippetText?: string): void {
    if (!this.editor) return;
    const q = query.toLowerCase().trim();
    if (!q) return;

    const result = findTextInProseMirror(q, matchIndex, snippetText);
    if (!result) return;

    const proseMirror = document.querySelector('.ProseMirror');
    if (!proseMirror) return;
    (proseMirror as HTMLElement).focus();

    requestAnimationFrame(() => {
      const range = document.createRange();
      const endOff = Math.min(result.offset + q.length, (result.node.textContent || '').length);
      let rect: DOMRect | null = null;
      try {
        range.setStart(result.node, result.offset);
        range.setEnd(result.node, endOff);
        rect = range.getBoundingClientRect();
      } catch {
        rect = null;
      }

      // Set ProseMirror selection at match
      this.editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = view.posAtDOM(result.node, result.offset);
        if (pos == null) return;
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pos, pos + q.length)
        );
        view.dispatch(tr);
      });
      if (!rect || rect.width === 0) {
        const parent = result.node.parentElement;
        if (parent) rect = parent.getBoundingClientRect();
      }
      if (!rect) return;

      const viewportHeight = window.innerHeight;
      const scrollEl = document.querySelector('.book-layout');
      const idealTop = Math.max(0, (viewportHeight - rect.height) / 2);
      if (Math.abs(rect.top - idealTop) > 2 && scrollEl) {
        scrollEl.scrollTop += rect.top - idealTop;
        rect = range.getBoundingClientRect();
      }

      const flash = document.createElement("div");
      flash.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: var(--color-warning);
        opacity: 0.5;
        border-radius: 3px;
        pointer-events: none;
        z-index: 9999;
        transition: opacity 0.7s ease;
      `;
      document.body.appendChild(flash);
      requestAnimationFrame(() => { flash.style.opacity = "0"; });
      setTimeout(() => flash.remove(), 800);
    });
  }

  /**
   * Cleanup editor
   */
  destroy(): void {
    this.editor = null;
    this.mentionView = null;
    this.clearStates();
  }
}
