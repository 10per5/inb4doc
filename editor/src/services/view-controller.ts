/**
 * ViewController — manages view switching and disk usage view.
 *
 * ViewManager was inlined here since it was only used as an implementation
 * detail of this controller. The view type and switching logic live together.
 */

import { stripFrontmatter } from "@/utils/frontmatter";
import type NoFileController from "@/controllers/no-file-controller";
import type { NoFileViewData } from "@/controllers/no-file-controller";
import type DirIndexEmptyController from "@/controllers/dir-index-empty-controller";
import type DiskUsageController from "@/controllers/disk-usage-controller";
import type { DiskUsageData } from "@/controllers/disk-usage-controller";
import { registerEditorView } from "@/services/editor-view";
import { pagesStore } from "@/stores/page-store";
import { getProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { getSuggestions } from "@/utils/tree";
import { getRecents } from "@/utils/recent-files";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { EditorController } from "@/controllers/editor-controller";
import * as focusHandler from "@/services/focus-handler";

export type ViewType = "editor" | "disk-usage" | "no-file" | "dir-index-empty"

type ViewHandlers = { activate: () => void; deactivate: () => void; focus?: () => void }

export class ViewController {
  private current: ViewType = "editor"
  private views = new Map<ViewType, ViewHandlers>()
  private editor: EditorController
  private sessionStarted: number
  private unsubs: (() => void)[] = [];
  private noFileLastPath: string = "";
  private dirIndexEmptyPath: string = "";

  constructor(editor: EditorController, sessionStarted: number = 0) {
    this.editor = editor;
    this.sessionStarted = sessionStarted;
    this.unsubs.push(
      appEvents.on(AppEvent.DirIndexEmpty, ({ path }) => {
        this.dirIndexEmptyPath = path;
        this.switchTo("dir-index-empty");
      }),
    );
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

  focusCurrent(): void {
    this.views.get(this.current)?.focus?.()
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
    this.setupDirIndexEmptyView();

    focusHandler.setDefaultFocus(() => this.focusCurrent());
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
  }

  private setupNoFileView(): void {
    const editorArea = this.editor.element as HTMLElement;
    const milkdownEl = this.editor.milkdownTarget;
    const sourceEl = this.editor.sourceTarget;
    const noFileEl = document.createElement("div");
    noFileEl.dataset.controller = "no-file";
    noFileEl.className = "no-file-view";
    noFileEl.style.display = "none";
    editorArea.appendChild(noFileEl);

    this.views.set("no-file", {
      activate: () => {
        this.editor.hideSkeleton();
        milkdownEl.style.display = "none";
        sourceEl.style.display = "none";
        const tree = treeStore.getTree();
        const isEmpty = treeStore.isEmpty();
        const recents = getRecents();
        const suggestions = getSuggestions(tree, this.noFileLastPath);
        noFileEl.style.display = "";
        const ctrl = this.editor.application.getControllerForElementAndIdentifier(
          noFileEl,
          "no-file",
        ) as NoFileController | null;
        ctrl?.load({ isEmpty, recents, suggestions });
      },
      deactivate: () => {
        noFileEl.style.display = "none";
      },
    });
  }

  private setupDiskUsageView(): void {
    const editorArea = this.editor.element as HTMLElement;
    const milkdownEl = this.editor.milkdownTarget;
    const sourceEl = this.editor.sourceTarget;
    const diskUsageEl = document.createElement("div");
    diskUsageEl.dataset.controller = "disk-usage";
    diskUsageEl.style.display = "none";
    editorArea.appendChild(diskUsageEl);

    this.views.set("disk-usage", {
      activate: () => {
        milkdownEl.style.display = "none";
        sourceEl.style.display = "none";
        diskUsageEl.style.display = "";
        this.showDiskUsage();
      },
      deactivate: () => {
        diskUsageEl.style.display = "none";
      },
    });
  }

  private setupDirIndexEmptyView(): void {
    const editorArea = this.editor.element as HTMLElement;
    const milkdownEl = this.editor.milkdownTarget;
    const sourceEl = this.editor.sourceTarget;
    const dirIndexEmptyEl = document.createElement("div");
    dirIndexEmptyEl.dataset.controller = "dir-index-empty";
    dirIndexEmptyEl.style.display = "none";
    editorArea.appendChild(dirIndexEmptyEl);

    this.views.set("dir-index-empty", {
      activate: () => {
        this.editor.hideSkeleton();
        milkdownEl.style.display = "none";
        sourceEl.style.display = "none";
        dirIndexEmptyEl.style.display = "";
        const ctrl = this.editor.application.getControllerForElementAndIdentifier(
          dirIndexEmptyEl,
          "dir-index-empty",
        ) as DirIndexEmptyController | null;
        ctrl?.load({ path: this.dirIndexEmptyPath });
      },
      deactivate: () => {
        dirIndexEmptyEl.style.display = "none";
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
      const leaves = Array.from(tree.paths);

      for (const leaf of leaves) {
        const existing = pagesStore.get(leaf);
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

        const st = pagesStore.get(leaf)?.getServerTime();
        if (st) lastModified.set(leaf, st);
      }

      if (self.current !== "disk-usage") return;

      const el = self.editor.element as HTMLElement;
      const diskUsageEl = el.querySelector<HTMLElement>('[data-controller="disk-usage"]');
      if (!diskUsageEl) return;

      const data: DiskUsageData = {
        tree,
        fileSizes,
        lastModified,
        providerName: getProviderDisplayInfo(provider.name).label,
        sessionStarted: self.sessionStarted,
      };

      const ctrl = self.editor.application.getControllerForElementAndIdentifier(
        diskUsageEl,
        "disk-usage",
      ) as DiskUsageController | null;
      ctrl?.load(data);
    })();
  }
}
