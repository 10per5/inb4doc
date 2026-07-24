/**
 * ViewController — manages view switching and disk usage view.
 *
 * ViewManager was inlined here since it was only used as an implementation
 * detail of this controller. The view type and switching logic live together.
 */

import { stripFrontmatter } from "@/utils/frontmatter";
import { mountDiskUsageView } from "@/components/views/disk-usage-view";
import { mountNoFileView, type NoFileViewData } from "@/components/views/no-file-view";
import { registerEditorView } from "@/components/views/editor-view";
import { pageRepository } from "@/repositories/pageRepository";
import { getProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { collectLeaves, getSuggestions } from "@/utils/tree";
import { getRecents } from "@/utils/recent-files";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { EditorController } from "@/controllers/editor-controller";

export type ViewType = "editor" | "disk-usage" | "no-file"

type ViewHandlers = { activate: () => void; deactivate: () => void }

export class ViewController {
  private current: ViewType = "editor"
  private views = new Map<ViewType, ViewHandlers>()
  private editor: EditorController
  private sessionStarted: number
  private unsubs: (() => void)[] = [];
  private noFileLastPath: string = "";

  constructor(editor: EditorController, sessionStarted: number = 0) {
    this.editor = editor;
    this.sessionStarted = sessionStarted;
  }

  switchTo(type: ViewType): void {
    if (type === this.current) return
    this.views.get(this.current)?.deactivate()
    this.current = type
    this.views.get(type)?.activate()
    appEvents.emit(AppEvent.ViewChanged, { view: type })
  }

  setNoFileLastPath(path: string): void {
    this.noFileLastPath = path;
  }

  getCurrent(): ViewType {
    return this.current
  }

  /** Expose register for editor-view.ts registration. */
  get register(): (type: ViewType, handlers: ViewHandlers) => void {
    return (type, handlers) => this.views.set(type, handlers)
  }

  initialize(): void {
    registerEditorView(this.register, {
      sourceMode: () => this.editor.isSourceMode(),
      milkdownEl: this.editor.milkdownTarget,
      sourceEl: this.editor.sourceTarget,
      editorArea: this.editor.element as HTMLElement,
    });

    this.setupDiskUsageView();
    this.setupNoFileView();
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
  }

  private setupNoFileView(): void {
    const editorArea = this.editor.element as HTMLElement;
    const milkdownEl = this.editor.milkdownTarget;
    const sourceEl = this.editor.sourceTarget;

    this.views.set("no-file", {
      activate: () => {
        milkdownEl.style.display = "none";
        sourceEl.style.display = "none";
        const tree = treeStore.getTree();
        const isEmpty = treeStore.isEmpty();
        const recents = getRecents();
        const suggestions = getSuggestions(tree, this.noFileLastPath);
        mountNoFileView(editorArea, { isEmpty, recents, suggestions });
      },
      deactivate: () => {
        const el = editorArea.querySelector(".no-file-view");
        if (el) el.remove();
      },
    });
  }

  private setupDiskUsageView(): void {
    const editorArea = this.editor.element as HTMLElement;
    const milkdownEl = this.editor.milkdownTarget;
    const sourceEl = this.editor.sourceTarget;

    this.views.set("disk-usage", {
      activate: () => {
        milkdownEl.style.display = "none";
        sourceEl.style.display = "none";
        this.showDiskUsage();
      },
      deactivate: () => {
        const du = editorArea.querySelector(".disk-usage-wrapper");
        if (du) du.remove();
      },
    });
  }

  private showDiskUsage(): void {
    const self = this;
    const tree = treeStore.getTree();
    const provider = getProvider();

    if (self.current !== "disk-usage") return;

    (async () => {
      const fileSizes = new Map<string, number>();
      const lastModified = new Map<string, number>();
      const leaves = collectLeaves(tree);

      for (const leaf of leaves) {
        const existing = pageRepository.get(leaf);
        const body = existing?.bodyState.body || existing?.bodyState.baseline;
        if (body) {
          fileSizes.set(leaf, body.length);
        } else {
          try {
            const content = await provider?.readFile(leaf);
            if (content && self.current === "disk-usage") {
              fileSizes.set(leaf, stripFrontmatter(content).body.length);
            }
          } catch (error) {
            console.error(`Failed to read ${leaf}:`, error);
          }
        }

        const st = pageRepository.get(leaf)?.getServerTime();
        if (st) lastModified.set(leaf, st);
      }

      const editorArea = self.editor.element as HTMLElement;
      if (self.current !== "disk-usage") return;

      mountDiskUsageView(
        editorArea,
        {
          tree,
          fileSizes,
          lastModified,
          providerName: getProviderDisplayInfo(provider.name).label,
          sessionStarted: self.sessionStarted,
        },
        () => self.switchTo("editor"),
      );
    })();
  }
}
