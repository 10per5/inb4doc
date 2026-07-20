/**
 * EditorController — Stimulus controller managing Milkdown editor lifecycle and state.
 *
 * Editor creation is delegated to config/editor-config.ts.
 * Conflict resolution is delegated to services/conflict-resolver.ts.
 * This class owns: path context, editor state, content loading, source mode.
 */

import { Controller } from "@hotwired/stimulus"
import { Editor, editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { EditorState } from "@milkdown/kit/prose/state";
import { parserCtx } from "@milkdown/core";
import { createEditor, type EditorHost } from "@/config/editor-config";
import { pageRepository } from "@/repositories/pageRepository";
import { toggleSourceMode, applySourceContent } from "@/features/editor-source";
import { getProvider } from "@/stores/provider-store";
import { stripFrontmatter } from "@/utils/frontmatter";
import { imageRepository } from "@/repositories/imageRepository";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { scheduleSave } from "@/stores/persistence";
import {
  resolveConflict,
  executeConflictDecision,
  applyNoConflict,
} from "@/services/conflict-resolver";
import { scrollToText } from "@/features/search/scroll-to-text";
import type { MentionView } from "@/features/mention";

export class EditorController extends Controller {
  static targets = ["milkdown", "source"]

  declare readonly milkdownTarget: HTMLElement
  declare readonly sourceTarget: HTMLElement

  private editor: Editor | null = null;
  private host: EditorHost | null = null;
  private editorStates = new Map<string, any>();
  private lastSetContent = new Map<string, string>();
  private mentionView: MentionView | null = null;
  private currentPath: string = "";
  private sourceMode: boolean = false;

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
      this.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        this.editorStates.set(prev, view.state);
      });
    }
    this.currentPath = path;
    if (this.host) this.host.currentPath = path;
    const dir = this.currentPathDir();
    imageRepository.setCurrentDocDir(dir);
    getProvider()
      .listImages?.(dir, false)
      .catch(() => {});
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
    this.editor = await createEditor(editorEl, content, host);
  }

  // ── Content loading ──

  async fetchContent(
    path: string,
    onMetaUpdate?: (data: any) => void,
  ): Promise<string | null> {
    try {
      const provider = getProvider();
      const raw = await provider?.readFile(path);
      if (raw === null) {
        const cached = pageRepository.get(path);
        const cachedBody = cached?.bodyState.body;
        if (cachedBody !== undefined) {
          const fm = cached!.getFrontmatter();
          if (fm) onMetaUpdate?.(fm);
          return cachedBody;
        }
        return null;
      }

      const { frontmatter, body } = stripFrontmatter(raw);
      const serverTime = await provider?.getServerTime(path);
      const page = pageRepository.get(path);
      const decision = resolveConflict(page, body, frontmatter, serverTime);

      if (!decision) {
        return applyNoConflict(
          path,
          body,
          frontmatter,
          serverTime,
          onMetaUpdate,
        );
      }

      executeConflictDecision(decision, path, raw, serverTime, {
        currentPath: this.currentPath,
        ensureEditor: (c) => this.ensureEditor(c),
        onMetaUpdate,
      });

      this.editorStates.delete(path);
      if (frontmatter) onMetaUpdate?.(frontmatter);
      return body;
    } catch {
      return null;
    }
  }

  async loadContent(
    path: string,
    onMetaUpdate?: (data: any) => void,
  ): Promise<void> {
    const content = await this.fetchContent(path, onMetaUpdate);
    return this.ensureEditor(content ?? "");
  }

  // ── Source mode ──

  toggleSourceMode(): boolean {
    if (!this.editor) return this.sourceMode;

    this.sourceMode = toggleSourceMode(
      this.editor,
      this.sourceTarget,
      this.milkdownTarget,
      this.sourceMode,
    );
    return this.sourceMode;
  }

  async applySourceContent(): Promise<void> {
    if (!this.editor) return;

    const textarea = this.sourceTarget.querySelector("textarea") as HTMLTextAreaElement;
    if (!textarea) return;

    this.lastSetContent.set(this.currentPath, "");
    applySourceContent(this.editor, textarea);

    const md = this.editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      return serializer(ctx.get(editorViewCtx).state.doc)
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
    });

    pageRepository.getOrCreate(this.currentPath).setBody(md);
    dirtyTrackingService.recompute();
    scheduleSave();
    this.sourceMode = false;

    this.sourceTarget.style.display = "none";
    this.milkdownTarget.style.display = "block";
  }

  // ── Content access ──

  getCurrentContent(): string {
    if (!this.editor) return "";
    return this.editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      return serializer(ctx.get(editorViewCtx).state.doc)
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
    });
  }

  scrollToText(query: string, matchIndex?: number, snippetText?: string): void {
    if (!this.editor) return;
    scrollToText(this.editor, query, matchIndex, snippetText);
  }

  // ── Cleanup ──

  disconnect() {
    this.destroy()
  }

  destroy(): void {
    this.editor = null;
    this.host = null;
    this.mentionView = null;
    this.editorStates.clear();
    this.lastSetContent.clear();
  }

  // ── Private ──

  private updateEditorContent(content: string): void {
    if (!this.editor) return;

    const cached = this.editorStates.get(this.currentPath);
    if (cached) {
      const page = pageRepository.get(this.currentPath);
      const persistedBody = page?.bodyState.body ?? page?.bodyState.baseline ?? "";
      this.lastSetContent.set(this.currentPath, persistedBody);
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
}

export default EditorController
