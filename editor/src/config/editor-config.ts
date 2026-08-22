/**
 * createEditor — builds the ProseKit editor with all plugins.
 *
 * Extracted from EditorController to keep config separate from lifecycle.
 * The `host` callback interface lets the editor communicate back to the
 * controller without circular imports.
 */

import { createEditor as prosekitCreateEditor, definePlugin, union } from "@prosekit/core";
import type { Extension } from "@prosekit/core";
import { defineCodeBlockShiki } from "@prosekit/extensions/code-block";
import type { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";

import { createSchemaExtension } from "./editor-schema";
import { createMarkdownBridge } from "./editor-markdown";

import { createImageResizeView } from "@/plugins/image-resize";
import { createImageInlineResizeView } from "@/plugins/image-inline-resize";
import { createKeymap, createCodeBlockMovePlugin, setEditorView } from "@/plugins/keyboard";
import { createBlockContextPlugin } from "@/plugins/block-context";
import { createTextStatePlugin } from "@/plugins/text-state";
import { createHistoryContextPlugin } from "@/plugins/history-context";
import { createCaretScrollPlugin } from "@/plugins/caret-scroll";
import { createPlainPastePlugin } from "@/plugins/plain-paste";
import { createInlineCodeInputPlugin } from "@/plugins/inline-code-input";
import { shortcodeDecoration } from "@/plugins/shortcode";
import { initHugoRefClicks } from "@/plugins/hugo-ref";
import { configureBlockEdit, block, slash } from "@/features/block-edit";
import { mathInlineInputRule, mathBlockInputRule } from "@/plugins/math";
import { codeBlockUI } from "@/plugins/code-block-ui";
import { videoView } from "@/plugins/video";
import { fixedTableBlockView } from "@/plugins/table-block-view";
import { createDirtyPlugin } from "@/plugins/dirty";
import { createMentionPlugin } from "@/plugins/mention";
import { createImagePastePlugin } from "@/plugins/image-paste";
import { createLinkBoundaryPlugin } from "@/plugins/link-boundary";
import { createUrlPastePlugin } from "@/plugins/url-paste";
import { createImageEditPlugin } from "@/plugins/image-edit";
import {
  createEditorDragDropPlugin,
  configureDropIndicator,
} from "@/plugins/editor-drag-drop";
import { imageService } from "@/services/image-service";
import { getProvider } from "@/stores/provider-store";
import { imageStore } from "@/stores/image-store";
import type { MentionView } from "@/features/mention";
import { isMobileDock } from "@/utils/mobile";

/** Callbacks the editor uses to talk back to the controller. */
export interface EditorHost {
  currentPathDir(): string;
  currentPath: string;
  stateCache: {
    getLastSet(path: string): string | undefined;
    setLastSet(path: string, content: string): void;
  };
  onMentionView(mv: MentionView | null): void;
}

/**
 * Resolves a stored image src to something the DOM can load. Pending/blob/
 * data URLs pass through; registered pending images map to their blob URLs;
 * everything else resolves against the current document directory so stored
 * content-relative paths render regardless of the mount point.
 */
function proxyDomURLFor(host: EditorHost): (url: string) => string {
  return (url: string) => {
    if (!url) return url;
    if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("blob:")) return url;
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
    if (url.startsWith("/")) return url;
    let relPath = url;
    if (dir && relPath.startsWith(dir + "/")) {
      relPath = relPath.slice(dir.length + 1);
    }
    return `/${dir}/${relPath}`;
  };
}

/**
 * EditorInstance wraps a ProseKit editor with an `.action()` helper for
 * backward compatibility with controller code that expects
 * `editor.action(ctx => ctx.get(editorViewCtx))`.
 */
export interface EditorInstance {
  readonly view: EditorView;
  readonly schema: Schema;
  action<T>(fn: (ctx: { view: EditorView; schema: Schema }) => T): T;
  mount(): void;
  unmount(): void;
  destroy(): void;
}

export async function createEditor(
  container: HTMLElement,
  content: string,
  host: EditorHost,
): Promise<EditorInstance> {
  const pdURL = proxyDomURLFor(host);

  const extensions: Extension[] = [
    createSchemaExtension(),
    createKeymap(),
    defineCodeBlockShiki(),

    definePlugin([
      createPlainPastePlugin(),
      createInlineCodeInputPlugin(),
      createUrlPastePlugin(),
      createDirtyPlugin({
        getLastSetContent: (path) => host.stateCache.getLastSet(path),
        setLastSetContent: (path, c) => host.stateCache.setLastSet(path, c),
        getCurrentPath: () => host.currentPath,
      }),
      createMentionPlugin((_mv: MentionView | null) => {
        host.onMentionView(_mv);
      }),
      createImagePastePlugin({
        uploadImage: (file: File) => imageService.uploadImage(file),
      }),
      createLinkBoundaryPlugin(),
      createImageEditPlugin(),
      createEditorDragDropPlugin({
        uploadImage: (file: File) => imageService.uploadImage(file),
      }),
      createCodeBlockMovePlugin(),
      createBlockContextPlugin(),
      createTextStatePlugin(),
      createHistoryContextPlugin(),
      ...(isMobileDock() ? [createCaretScrollPlugin()] : []),
      block,
      slash,
      shortcodeDecoration,
      mathInlineInputRule,
      mathBlockInputRule,
    ]),

    fixedTableBlockView,
    createImageResizeView(pdURL),
    createImageInlineResizeView(pdURL),
    codeBlockUI,
    videoView,
  ];

  const prosekitEditor = prosekitCreateEditor({ extension: union(extensions) });

  // Set content: parse markdown into a PM doc, then set it directly on the
  // editor's state (before mount, the schema is available via editor.schema).
  const bridge = createMarkdownBridge(prosekitEditor.schema);
  const doc = bridge.parse(content);
  prosekitEditor.setContent(doc);

  configureDropIndicator();
  configureBlockEdit();

  // Mount into the DOM
  prosekitEditor.mount(container);

  // Store view reference for keymap handlers that need it (e.g. cutBlock)
  setEditorView(prosekitEditor.view);

  // Post-mount: wire up behaviors that need the live EditorView
  initHugoRefClicks(prosekitEditor.view);

  // Wrap in an EditorInstance that provides .action() for backward compat
  const instance: EditorInstance = {
    get view() {
      return prosekitEditor.view;
    },
    get schema() {
      return prosekitEditor.view.state.schema;
    },
    action<T>(fn: (ctx: { view: EditorView; schema: Schema }) => T): T {
      return fn({
        view: prosekitEditor.view,
        schema: prosekitEditor.view.state.schema,
      });
    },
    mount() {
      prosekitEditor.mount(container);
    },
    unmount() {
      prosekitEditor.unmount();
    },
    destroy() {
      prosekitEditor.unmount();
    },
  };

  return instance;
}
