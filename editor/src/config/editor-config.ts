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
import { commonmark as _commonmark, wrapInHeadingInputRule, headingKeymap } from "@milkdown/kit/preset/commonmark";
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
import { createKeymap, createCodeBlockMovePlugin } from "@/plugins/keyboard";
import { createBlockContextPlugin } from "@/plugins/block-context";
import { createTextStatePlugin } from "@/plugins/text-state";
import { createHistoryContextPlugin } from "@/plugins/history-context";
import { createCaretScrollPlugin } from "@/plugins/caret-scroll";
import { isMobileDock } from "@/utils/mobile";
import {
  copy,
  editPencil,
  trash,
  check,
  plus,
  x,
  alignLeft,
  alignCenter,
  alignRight,
  menuScale,
  table,
} from "@/eta/icons";
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
import { createUrlPastePlugin } from "@/plugins/url-paste";
import { createImageEditPlugin } from "@/plugins/image-edit";
import { imageService } from "@/services/image-service";
import { getProvider } from "@/stores/provider-store";
import { imageStore } from "@/stores/image-store";
import type { MentionView } from "@/features/mention";

/** Callbacks the editor uses to talk back to the controller. */
export interface EditorHost {
  currentPathDir(): string
  currentPath: string
  stateCache: {
    getLastSet(path: string): string | undefined
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

      // Milkdown's DowngradeHeading binds Backspace/Delete at heading start to
      // step the level down one `#` at a time (## → # → paragraph). Disable the
      // shortcut; the replacement (heading → paragraph directly) lives in
      // @/plugins/keyboard.
      ctx.update(headingKeymap.key, (prev) => ({
        ...prev,
        DowngradeHeading: { ...prev.DowngradeHeading, shortcuts: [] },
      }));

      ctx.update(dropIndicatorConfig.key, () => ({
        class: "inb4doc-drop-cursor",
        width: 4,
        color: false as const,
      }));

      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        // Keep list markers consistent: bullets as `*` (not `-`), numbers as
        // `1.` (not `1)`). These are mdast-util-to-markdown options; Milkdown
        // emits the marker for the `listItem` node via the stringifier.
        // (bulletOther is intentionally left at its default — it must differ
        // from `bullet` so nested same-type lists can be disambiguated.)
        bullet: "*" as const,
        bulletOrdered: "." as const,
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
        linkIcon: copy,
        editButton: editPencil,
        removeButton: trash,
        confirmButton: check,
        inputPlaceholder: "Paste link...",
      }));

      ctx.update(tableBlockConfig.key, (prev) => ({
        ...prev,
        renderButton: (renderType) => {
          switch (renderType) {
            case "add_row":
              return `${plus} Row`;
            case "add_col":
              return `${plus} Col`;
            case "delete_row":
              return x;
            case "delete_col":
              return x;
            case "align_col_left":
              return alignLeft;
            case "align_col_center":
              return alignCenter;
            case "align_col_right":
              return alignRight;
            case "col_drag_handle":
              return menuScale;
            case "row_drag_handle":
              return table;
          }
        },
      }));

      ctx.update(imageBlockConfig.key, (prev) => ({
        ...prev,
        onUpload: (file: File) => imageService.uploadImage(file),
        proxyDomURL: (url: string) => {
          if (!url) return url;
          if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("blob:")) return url;
          if (url.startsWith("/uploads/")) return url;
          if (url.startsWith("inb4doc-image:")) {
            const name = url.slice("inb4doc-image:".length);
            return imageStore.getImage(name) || url;
          }
          if (url.startsWith("pending-image:")) {
            const blobUrl = imageService.getBlobUrl(url.slice("pending-image:".length));
            if (blobUrl) return blobUrl;
          }
          const provider = getProvider();
          const resolved = provider.resolveImageUrl?.(url);
          if (resolved) return resolved;
          const dir = host.currentPathDir();
          let relPath = url;
          if (relPath.startsWith("/")) {
            relPath = relPath.slice(1);
            if (dir && relPath.startsWith(dir + "/")) {
              relPath = relPath.slice(dir.length + 1);
            }
          }
          return `/uploads/${dir}/${relPath}`;
        },
      }));

      ctx.update(prosePluginsCtx, (plugins) => {
        return plugins.concat(
          createUrlPastePlugin(),
          createDirtyPlugin(ctx, {
            getLastSetContent: (path) => host.stateCache.getLastSet(path),
            setLastSetContent: (path, content) => host.stateCache.setLastSet(path, content),
            getCurrentPath: () => host.currentPath,
          }),
          createMentionPlugin(ctx, (mv) => { host.onMentionView(mv) }),
          createImagePastePlugin({ uploadImage: (file: File) => imageService.uploadImage(file) }),
          createLinkBoundaryPlugin(),
          createImageEditPlugin(),
          createKeymap(),
          createCodeBlockMovePlugin(),
          createBlockContextPlugin(),
          createTextStatePlugin(),
          createHistoryContextPlugin(),
          // Mobile-only: taps that leave the caret outside the visible band
          // get scrolled back into view. Skipped entirely on desktop builds
          // (and desktop-sized viewports in adaptive web builds).
          ...(isMobileDock() ? [createCaretScrollPlugin()] : []),
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
