/**
 * EditorController — Stimulus controller managing ProseKit editor lifecycle and state.
 *
 * Editor creation is delegated to config/editor-config.ts.
 * Conflict resolution is delegated to features/conflict-resolver.ts.
 * This class owns: path context, editor state, content loading, source mode.
 */

import { Controller } from "@hotwired/stimulus";
import type { EditorInstance } from "@/config/editor-config";
import { createEditor, type EditorHost } from "@/config/editor-config";
import { getMarkdown } from "@/config/editor-markdown";
import { createMarkdownBridge } from "@/config/editor-markdown";
import { TextSelection } from "prosemirror-state";
import { EditorState } from "prosemirror-state";
import { initEditorMutationService } from "@/services/editor-mutation-service";
import { initLinkHandler } from "@/features/link-handler";
import { appEvents, AppEvent } from "@/stores/app-events";
import { pagesStore } from "@/stores/page-store";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps, PendingOpType } from "@/entities/PendingOps";
import { showSourceMode, hideSourceMode } from "@/features/editor-source";
import renderSourceEditor from "@/eta/views/controller/source-editor";
import { getProvider } from "@/stores/provider-store";
import { stripFrontmatter } from "@/utils/frontmatter";
import { merge3 } from "@/utils/merge3";
import { imageService } from "@/services/image-service";
import {
  resolveConflict,
  executeConflictDecision,
  applyNoConflict,
} from "@/features/conflict-resolver";
import {
  findTextMatch,
  findHeadingTarget,
  matchRect,
  flashHighlight,
  centerOnRect,
  type TextMatch,
} from "@/features/search/scroll-to-text";
import type { MentionView } from "@/features/mention";
import { initSpellcheck, applySpellcheck } from "@/plugins/spellcheck";

export interface OutlineItem {
  level: number;
  text: string;
  pos: number;
}

/**
 * Trailing-newline-insensitive body comparison.
 *
 * The markdown serializer emits no trailing newline, while on-disk bodies and
 * the merge output retain whichever trailing newline the file had. Comparing
 * raw bytes would therefore treat a canonical file as "unformatted".
 */
function sameBody(a: string, b: string): boolean {
  return a.replace(/\n+$/, "") === b.replace(/\n+$/, "");
}

export class EditorController extends Controller {
  static targets = ["inb4doc", "source", "loadLogo"];

  declare readonly inb4docTarget: HTMLElement;
  declare readonly sourceTarget: HTMLElement;
  declare readonly loadLogoTarget: HTMLElement;

  private editor: EditorInstance | null = null;
  private host: EditorHost | null = null;
  private editorStates = new Map<string, any>();
  private editorContents = new Map<string, string>();
  private lastSetContent = new Map<string, string>();
  private mentionView: MentionView | null = null;
  private currentPath: string = "";
  private sourceMode: boolean = false;
  private sourceEntryContent: string = "";
  private unsubs: (() => void)[] = [];

  // ── Accessors ──

  getEditor(): EditorInstance | null {
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
    this.editorContents.delete(path);
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
      const view = this.editor.view;
      this.editorStates.set(prev, view.state);
      this.editorContents.set(prev, this.serializeDoc(view));
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
    this.inb4docTarget.style.visibility = "hidden";
  }

  hideSkeleton(): void {
    const el = document.getElementById("editor-skeleton");
    el?.classList.add("is-hidden");
    this.loadLogoTarget.classList.add("is-hidden");
    this.inb4docTarget.style.visibility = "";
  }

  // ── Editor lifecycle ──

  async ensureEditor(content: string): Promise<void> {
    content ??= "";
    if (this.editor) {
      this.updateEditorContent(content);
      return;
    }

    const editorEl = this.inb4docTarget;
    const host: EditorHost = {
      currentPathDir: () => this.currentPathDir(),
      currentPath: this.currentPath,
      stateCache: {
        getLastSet: (p: string) => this.lastSetContent.get(p),
        setLastSet: (p: string, c: string) => {
          this.lastSetContent.set(p, c);
        },
      },
      onMentionView: (mv) => {
        this.mentionView = mv;
      },
    };
    this.host = host;
    this.lastSetContent.delete(this.currentPath);
    this.editor = await createEditor(editorEl, content, host);
    this.lastSetContent.set(
      this.currentPath,
      this.serializeDoc(this.editor.view)
    );
    appEvents.emit(AppEvent.OutlineChanged);
    applySpellcheck(this.editor.view);
    this.scrollEditorToTop();
  }

  /**
   * Focus the empty title heading of a freshly created page (File ▸ New /
   * "+ New") so typing starts immediately. The heading already renames the
   * file on input (features/auto-name); this only places the caret.
   */
  focusFirstHeading(): void {
    const view = this.editor?.view;
    if (!view) return;
    const first = view.state.doc.firstChild;
    if (!first || first.type.name !== "heading" || first.content.size > 0) {
      return;
    }
    view.focus();
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.near(view.state.doc.resolve(0), 1))
        .scrollIntoView(),
    );
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
      this.editorContents.delete(path);
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

    if (this.sourceMode) {
      hideSourceMode(this.sourceTarget, this.inb4docTarget);
      this.sourceMode = false;
    } else {
      showSourceMode(this.sourceTarget, this.inb4docTarget, () =>
        getMarkdown(this.editor!)
      );
      const ta = this.sourceTarget.querySelector(
        "textarea"
      ) as HTMLTextAreaElement;
      this.sourceEntryContent = ta ? ta.value : "";
      this.sourceMode = true;
    }
    return this.sourceMode;
  }

  async applySourceContent(): Promise<void> {
    if (!this.editor) return;

    const textarea = this.sourceTarget.querySelector(
      "textarea"
    ) as HTMLTextAreaElement;
    if (!textarea) return;

    const md = textarea.value;
    this.exitSourceMode();

    this.lastSetContent.delete(this.currentPath);
    this.setEditorContent(md);
    appEvents.emit(AppEvent.SourceApplyRequested, {
      path: this.currentPath,
      content: md,
    });
  }

  async cancelSourceContent(): Promise<void> {
    if (!this.editor) return;

    this.exitSourceMode();
    appEvents.emit(AppEvent.SingleDiscardRequested, { path: this.currentPath });
  }

  private exitSourceMode(): void {
    if (!this.sourceMode) return;
    hideSourceMode(this.sourceTarget, this.inb4docTarget);
    this.sourceMode = false;
  }

  // ── Content access ──

  getCurrentContent(): string {
    if (this.sourceMode) {
      const ta = this.sourceTarget.querySelector(
        "textarea"
      ) as HTMLTextAreaElement;
      if (ta && ta.value !== this.sourceEntryContent) {
        return ta.value.replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
      }
    }
    if (!this.editor) return "";
    return this.serializeDoc(this.editor.view);
  }

  /**
   * True when the file currently in the editor still has unformatted regions,
   * i.e. a normal (merge-preserving) save would leave raw formatting behind.
   * This stays true while the user edits untouched sections — the affordance
   * is gated on "the file could be tidied", not on "no pending edits". Used to
   * drive the File → Format document item. Never queues an op (read-only probe).
   */
  isFormattable(): boolean {
    if (!this.editor || this.sourceMode) return false;
    const path = this.currentPath;
    const baseline = pagesStore.get(path)?.bodyState.baseline;
    if (baseline === undefined) return false;

    // A whole-file format already requested? Then there is nothing left to do.
    const editOp = pendingOpsStore.load().find(
      (o) => o.type === PendingOpType.Edit && o.path === path
    ) as { fullFormat?: boolean } | undefined;
    if (editOp?.fullFormat) return false;

    const c0 = this.canonicalize(baseline);
    // The raw on-disk body is already canonical: nothing to tidy. Compare
    // ignoring trailing newlines — the serializer never emits one, while an
    // on-disk body (and the merge output) keeps the file's original newline,
    // so a raw byte comparison would report every loaded file as formattable.
    if (sameBody(baseline, c0)) return false;
    // Otherwise a normal (merge-preserving) save keeps the raw formatting of
    // untouched regions; the file is formattable iff that merged body still
    // differs from the fully canonical serialization.
    const canonical = this.getCurrentContent();
    return !sameBody(merge3(baseline, c0, canonical).merged, canonical);
  }

  /**
   * Canonical Markdown for arbitrary body text (parse + serialize) using the
   * editor's schema. Used as the 3-way-merge ancestor (C0) so per-section
   * saves can preserve the raw on-disk formatting of untouched blocks.
   */
  canonicalize(md: string): string {
    if (!this.editor) return md;
    const bridge = createMarkdownBridge(this.editor.schema);
    return bridge
      .serialize(bridge.parse(md))
      .replace(/\r\n/g, "\n")
      .replace(/\n+$/, "\n");
  }

  private serializeDoc(view: any): string {
    return this.serializeState(view.state);
  }

  private serializeState(state: EditorState): string {
    const bridge = createMarkdownBridge(state.schema);
    return bridge.serialize(state.doc)
      .replace(/\r\n/g, "\n")
      .replace(/\n+$/, "\n");
  }

  scrollToText(query: string, matchIndex?: number, snippetText?: string): void {
    if (!this.editor) return;
    const match = findTextMatch(query, matchIndex, snippetText);
    if (!match) return;
    this.jumpToProseMirror(match);
  }

  /**
   * Jump to a heading by re-locating it in the live DOM (same accurate
   * reference technique as Ctrl+F search). `fallbackPos` is a stored doc
   * position used only when the heading can't be found in the DOM.
   */
  scrollToHeading(text: string, level: number, fallbackPos?: number): void {
    if (!this.editor) return;
    const match = findHeadingTarget(text, level);
    if (match) {
      this.jumpToProseMirror(match);
      return;
    }
    if (fallbackPos == null) return;
    this.editor.action(({ view }) => {
      const doc = view.state.doc;
      if (fallbackPos < 0 || fallbackPos > doc.content.size) return;
      const tr = view.state.tr.setSelection(
        TextSelection.near(doc.resolve(fallbackPos + 1)),
      );
      view.dispatch(tr.scrollIntoView());
    });
  }

  private jumpToProseMirror(match: TextMatch): void {
    const proseMirror = document.querySelector(".ProseMirror");
    if (proseMirror) (proseMirror as HTMLElement).focus();

    requestAnimationFrame(() => {
      this.editor!.action(({ view }) => {
        const pos = view.posAtDOM(match.node, match.offset);
        if (pos == null) return;
        const tr = view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            pos,
            pos + match.length,
          ),
        );
        view.dispatch(tr);
      });
      if (match.rect) {
        const initialRect = match.rect;
        centerOnRect(initialRect);
        // The scroll changes viewport coords, so recompute the rect after it
        // settles and flash the target at its real on-screen position.
        requestAnimationFrame(() => {
          const rect = matchRect(match) ?? initialRect;
          flashHighlight(rect);
        });
      }
    });
  }

  getOutline(): OutlineItem[] {
    if (!this.editor || this.sourceMode) return [];
    return this.editor.action(({ view }) => {
      const items: OutlineItem[] = [];
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          const text = node.textContent.trim();
          if (text) items.push({ level: node.attrs.level as number, text, pos });
        }
      });
      return items;
    });
  }

  // ── Lifecycle ──

  connect() {
    if (!this.element.querySelector("#source-editor")) {
      this.element.insertAdjacentHTML("beforeend", renderSourceEditor({}));
    }
    this.unsubs.push(
      initEditorMutationService(() => this.editor),
      initLinkHandler(() => this.editor?.action(({ view }) => view) ?? null),
      initSpellcheck(() => this.editor?.action(({ view }) => view) ?? null),
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
    this.editorContents.clear();
    this.lastSetContent.clear();
    if (editor) {
      editor.destroy();
      this.inb4docTarget.replaceChildren();
    }
  }

  // ── Private ──

  // Reset the editor's scroll containers to the top when a document is opened
  // or navigated to, so navigation/app-open lands on the document start rather
  // than carrying over the previous page's scroll position.
  private scrollEditorToTop(): void {
    const view = this.editor?.view;
    const targets = new Set<HTMLElement>();
    const layout = document.querySelector<HTMLElement>(".book-layout");
    if (layout) targets.add(layout);
    let el: HTMLElement | null = (view?.dom as HTMLElement) ?? null;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 1) targets.add(el);
      el = el.parentElement;
    }
    for (const t of targets) {
      t.scrollTop = 0;
      t.scrollLeft = 0;
    }
  }

  private updateEditorContent(content: string): void {
    if (!this.editor) return;

    const cached = this.editorStates.get(this.currentPath);
    const cachedContent = this.editorContents.get(this.currentPath);
    if (cached && cachedContent !== undefined && cachedContent === content) {
      // Restoring a cached doc must not read as a format change: prime the
      // dirty plugin with the CANONICAL serialization of the restored doc,
      // not the raw persisted body. A non-canonical file would otherwise diff
      // (serialize(doc) !== raw body) on this update and re-queue itself as a
      // whole-file "formatted" Edit op (same priming as ensureEditor below).
      this.lastSetContent.set(this.currentPath, this.serializeState(cached));
      this.editor.action(({ view }) => {
        view.updateState(cached);
      });
    } else {
      this.lastSetContent.delete(this.currentPath);
      this.editor.action(({ view }) => {
        const bridge = createMarkdownBridge(view.state.schema);
        const doc = bridge.parse(content);
        const newState = EditorState.create({
          schema: view.state.schema,
          doc,
          plugins: view.state.plugins,
        });
        view.updateState(newState);
        this.editorStates.set(this.currentPath, newState);
        this.editorContents.set(this.currentPath, content);
      });
      this.scrollEditorToTop();
    }
    appEvents.emit(AppEvent.OutlineChanged);
  }

  private setEditorContent(content: string): void {
    if (!this.editor) return;
    this.editor.action(({ view }) => {
      const bridge = createMarkdownBridge(view.state.schema);
      const doc = bridge.parse(content);
      const newState = EditorState.create({
        schema: view.state.schema,
        doc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);
    });
    appEvents.emit(AppEvent.OutlineChanged);
  }
}

export default EditorController;
