/**
 * EditorController — Stimulus controller managing Milkdown editor lifecycle and state.
 *
 * Editor creation is delegated to config/editor-config.ts.
 * Conflict resolution is delegated to services/conflict-resolver.ts.
 * This class owns: path context, editor state, content loading, source mode.
 */

import { Controller } from "@hotwired/stimulus";
import type { Editor } from "@milkdown/kit/core";
import { createEditor, type EditorHost } from "@/config/editor-config";
import { editorContext, getMarkdown, getView } from "@/services/editor-context";
import { initToolbarHandler } from "@/features/toolbar-handler";
import { initLinkHandler } from "@/features/link-handler";
import { appEvents, AppEvent } from "@/stores/app-events";
import { pagesStore } from "@/stores/page-store";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps, PendingOpType } from "@/entities/PendingOps";
import { toggleSourceMode, applySourceContent } from "@/features/editor-source";
import renderSourceEditor from "@/eta/views/controller/source-editor";
import { getProvider } from "@/stores/provider-store";
import { stripFrontmatter } from "@/utils/frontmatter";
import { imageService } from "@/services/image-service";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import {
  resolveConflict,
  executeConflictDecision,
  applyNoConflict,
} from "@/services/conflict-resolver";
import {
  findTextMatch,
  flashHighlight,
  centerOnRect,
} from "@/features/search/scroll-to-text";
import type { MentionView } from "@/features/mention";

export class EditorController extends Controller {
  static targets = ["milkdown", "source", "loadLogo"];

  declare readonly milkdownTarget: HTMLElement;
  declare readonly sourceTarget: HTMLElement;
  declare readonly loadLogoTarget: HTMLElement;

  private editor: Editor | null = null;
  private host: EditorHost | null = null;
  private editorStates = new Map<string, any>();
  private lastSetContent = new Map<string, string>();
  private mentionView: MentionView | null = null;
  private currentPath: string = "";
  private sourceMode: boolean = false;
  private unsubs: (() => void)[] = [];

  // ── Accessors ──

  getEditor(): Editor | null {
    return this.editor;
  }
  getMentionView(): MentionView | null {
    return this.mentionView;
  }
  isSourceMode(): boolean {
    return this.sourceMode;
  }

  invalidateState(path: string): void {
    this.editorStates.delete(path);
  }

  currentPathDir(): string {
    return this.currentPath.includes("/")
      ? this.currentPath.substring(0, this.currentPath.lastIndexOf("/"))
      : "";
  }

  // ── Path context ──

  setCurrentPath(path: string): void {
    const prev = this.currentPath;
    if (prev && prev !== path && this.editor) {
      const view = getView(this.editor);
      this.editorStates.set(prev, view.state);
    }
    this.currentPath = path;
    if (this.host) this.host.currentPath = path;
    const dir = this.currentPathDir();
    imageService.setCurrentDocDir(dir);
    getProvider()
      .listImages?.(dir, false)
      .catch(() => {});
  }

  // ── Skeleton ──

  showSkeleton(): void {
    const el = document.getElementById("editor-skeleton");
    el?.classList.remove("is-hidden");
    this.milkdownTarget.style.visibility = "hidden";
  }

  hideSkeleton(): void {
    const el = document.getElementById("editor-skeleton");
    el?.classList.add("is-hidden");
    this.loadLogoTarget.classList.add("is-hidden");
    this.milkdownTarget.style.visibility = "";
  }

  // ── Editor lifecycle ──

  async ensureEditor(content: string): Promise<void> {
    content ??= "";
    if (this.editor) {
      this.updateEditorContent(content);
      return;
    }

    const editorEl = this.milkdownTarget;

    const host: EditorHost = {
      currentPathDir: () => this.currentPathDir(),
      currentPath: this.currentPath,
      stateCache: {
        getLastSet: (p: string) => this.lastSetContent.get(p) ?? "",
        setLastSet: (p: string, c: string) => {
          this.lastSetContent.set(p, c);
        },
      },
      onMentionView: (mv) => {
        this.mentionView = mv;
      },
    };
    this.host = host;
    this.lastSetContent.set(this.currentPath, "");
    await editorContext.load();
    this.editor = await createEditor(editorEl, content, host);
  }

  // ── Content loading ──

  async fetchContent(
    path: string,
    onMetaUpdate?: (data: any) => void
  ): Promise<string | null> {
    try {
      const provider = getProvider();
      const raw = await provider?.readFile(path);
      if (raw === null) {
        const cached = pagesStore.get(path);
        const cachedBody = cached?.bodyState.body ?? cached?.bodyState.baseline;
        if (cachedBody !== undefined) {
          const fm = cached!.getFrontmatter();
          if (fm) onMetaUpdate?.(fm);
          return cachedBody;
        }
        const ops = pendingOpsStore.load();
        const createOp = ops.find(
          (o) => o.type === PendingOpType.Create && o.path === path
        ) as { content?: string } | undefined;
        if (createOp?.content) {
          const { frontmatter, body } = stripFrontmatter(createOp.content);
          const page = pagesStore.getOrCreate(path);
          if (frontmatter) {
            const { Frontmatter } = await import("@/entities/Frontmatter");
            page.frontmatter = Frontmatter.fromMeta(frontmatter);
            onMetaUpdate?.(page.getFrontmatter());
          }
          page.bodyState.cacheBody(body);
          page.setBaseline(body);
          return body;
        }
        return null;
      }

      const { frontmatter, body } = stripFrontmatter(raw);
      const serverTime = await provider?.getServerTime(path);
      const page = pagesStore.get(path);
      const savedOps = pendingOpsStore.load();
      const localPendingOps = new PendingOps(savedOps);
      const decision = resolveConflict(
        page,
        body,
        frontmatter,
        serverTime,
        localPendingOps
      );

      if (!decision) {
        return applyNoConflict(
          path,
          body,
          frontmatter,
          serverTime,
          onMetaUpdate,
          localPendingOps
        );
      }

      executeConflictDecision(
        decision,
        path,
        raw,
        serverTime,
        {
          currentPath: this.currentPath,
          ensureEditor: (c) => this.ensureEditor(c),
          onMetaUpdate,
        },
        localPendingOps
      );

      this.editorStates.delete(path);
      if (frontmatter) onMetaUpdate?.(frontmatter);

      const editOp = localPendingOps.findEdit(path);
      if (editOp && editOp.patch) {
        return editOp.patch;
      }
      return body;
    } catch {
      return null;
    }
  }

  async loadContent(
    path: string,
    onMetaUpdate?: (data: any) => void
  ): Promise<void> {
    const content = await this.fetchContent(path, onMetaUpdate);
    return this.ensureEditor(content ?? "");
  }

  // ── Source mode ──

  toggleSourceMode(): boolean {
    if (!this.editor) return this.sourceMode;

    this.sourceMode = toggleSourceMode(
      this.sourceTarget,
      this.milkdownTarget,
      this.sourceMode,
      () => getMarkdown(this.editor!),
      (content) => this.setEditorContent(content)
    );
    return this.sourceMode;
  }

  async applySourceContent(): Promise<void> {
    if (!this.editor) return;

    const textarea = this.sourceTarget.querySelector(
      "textarea"
    ) as HTMLTextAreaElement;
    if (!textarea) return;

    this.lastSetContent.set(this.currentPath, "");
    applySourceContent(textarea, (content) => this.setEditorContent(content));

    const md = getMarkdown(this.editor);

    pagesStore.getOrCreate(this.currentPath).setBody(md);
    dirtyTrackingService.recompute();
    this.sourceMode = false;

    this.sourceTarget.style.display = "none";
    this.milkdownTarget.style.display = "block";
  }

  // ── Content access ──

  getCurrentContent(): string {
    if (!this.editor) return "";
    return this.editor.action((ctx) => {
      const serializer = ctx.get(editorContext.serializerCtx);
      return serializer(ctx.get(editorContext.editorViewCtx).state.doc)
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
    });
  }

  scrollToText(query: string, matchIndex?: number, snippetText?: string): void {
    if (!this.editor) return;
    const match = findTextMatch(query, matchIndex, snippetText);
    if (!match) return;

    const proseMirror = document.querySelector(".ProseMirror");
    if (proseMirror) (proseMirror as HTMLElement).focus();

    requestAnimationFrame(() => {
      this.editor!.action((ctx) => {
        const view = ctx.get(editorContext.editorViewCtx);
        const pos = view.posAtDOM(match.node, match.offset);
        if (pos == null) return;
        const tr = view.state.tr.setSelection(
          editorContext.TextSelection.create(
            view.state.doc,
            pos,
            pos + match.length
          )
        );
        view.dispatch(tr);
      });
      if (match.rect) {
        centerOnRect(match.rect);
        flashHighlight(match.rect);
      }
    });
  }

  // ── Lifecycle ──

  connect() {
    if (!this.element.querySelector("#source-editor")) {
      this.element.insertAdjacentHTML("beforeend", renderSourceEditor({}));
    }
    this.unsubs.push(
      initToolbarHandler(() => this.editor),
      initLinkHandler(() => this.editor),
      appEvents.on(
        AppEvent.ScrollToText,
        ({ query, matchIndex, snippetText }) => {
          this.scrollToText(query, matchIndex, snippetText);
        }
      )
    );
  }

  disconnect() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.destroy();
  }

  destroy(): void {
    const editor = this.editor;
    this.editor = null;
    this.host = null;
    this.mentionView = null;
    this.editorStates.clear();
    this.lastSetContent.clear();
    if (editor) {
      void editor.destroy().catch(() => {});
      this.milkdownTarget.replaceChildren();
    }
  }

  // ── Private ──

  private updateEditorContent(content: string): void {
    if (!this.editor) return;

    const cached = this.editorStates.get(this.currentPath);
    if (cached) {
      const page = pagesStore.get(this.currentPath);
      const persistedBody =
        page?.bodyState.body ?? page?.bodyState.baseline ?? "";
      this.lastSetContent.set(this.currentPath, persistedBody);
      this.editor.action((ctx) => {
        const view = ctx.get(editorContext.editorViewCtx);
        view.updateState(cached);
      });
    } else {
      this.lastSetContent.set(this.currentPath, "");
      this.editor.action((ctx) => {
        const parser = ctx.get(editorContext.parserCtx);
        const view = ctx.get(editorContext.editorViewCtx);
        const doc = parser(content);
        const newState = editorContext.EditorState.create({
          schema: view.state.schema,
          doc,
          plugins: view.state.plugins,
        });
        view.updateState(newState);
        this.editorStates.set(this.currentPath, newState);
      });
    }
  }

  private setEditorContent(content: string): void {
    if (!this.editor) return;
    this.editor.action((ctx) => {
      const parser = ctx.get(editorContext.parserCtx);
      const view = ctx.get(editorContext.editorViewCtx);
      const doc = parser(content);
      const newState = editorContext.EditorState.create({
        schema: view.state.schema,
        doc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);
    });
  }
}

export default EditorController;
