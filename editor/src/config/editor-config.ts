/**
 * createEditor — builds the Milkdown editor with all plugins.
 *
 * Extracted from EditorController to keep config separate from lifecycle.
 * The `host` callback interface lets the editor communicate back to the
 * controller without circular imports.
 */

import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  prosePluginsCtx,
} from "@milkdown/kit/core";
import { commonmark as _commonmark, wrapInHeadingInputRule } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { nord } from "@milkdown/theme-nord";
import { EditorState, NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
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
import { imageRepository } from "@/repositories/imageRepository";
import { getProvider } from "@/stores/provider-store";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { MentionView } from "@/features/mention";

/** Callbacks the editor uses to talk back to the controller. */
export interface EditorHost {
  currentPathDir(): string
  currentPath: string
  stateCache: {
    getLastSet(path: string): string
    setLastSet(path: string, content: string): void
  }
  onMentionView(mv: MentionView | null): void
}

export async function createEditor(
  container: HTMLElement,
  content: string,
  host: EditorHost,
): Promise<Editor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, content);
      configureBlockEdit(ctx);

      ctx.update(dropIndicatorConfig.key, () => ({
        class: "inb4doc-drop-cursor",
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
        onUpload: (file: File) => imageRepository.uploadImage(file),
        proxyDomURL: (url: string) => {
          if (!url) return url;
          if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("blob:")) return url;
          if (url.startsWith("/uploads/")) return url;
          if (url.startsWith("inb4doc-image:")) {
            const name = url.slice("inb4doc-image:".length);
            return localStorage.getItem("inb4doc:image:" + name) || url;
          }
          if (url.startsWith("pending-image:")) {
            const blobUrl = imageRepository.getBlobUrl(url.slice("pending-image:".length));
            if (blobUrl) return blobUrl;
          }
          const provider = getProvider();
          const resolved = provider.resolveImageUrl?.(url);
          if (resolved) return resolved;
          return `/uploads/${host.currentPathDir()}/${url}`;
        },
      }));

      ctx.update(prosePluginsCtx, (plugins) => {
        return plugins.concat(
          createDirtyPlugin(ctx, {
            getLastSetContent: (path) => host.stateCache.getLastSet(path),
            setLastSetContent: (path, content) => host.stateCache.setLastSet(path, content),
            getCurrentPath: () => host.currentPath,
            onDirtyChange: () => appEvents.emit(AppEvent.EditorDirty),
          }),
          createMentionPlugin(ctx, (mv) => { host.onMentionView(mv) }),
          createImagePastePlugin({ uploadImage: (file: File) => imageRepository.uploadImage(file) }),
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
          key: new PluginKey("inb4doc-drag-drop"),
          props: {
            handleDOMEvents: {
              dragstart(view, event) {
                  const v = view as any;
                  if (v.draggable?.move) {
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

                      (v.draggable as any).node = {
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
