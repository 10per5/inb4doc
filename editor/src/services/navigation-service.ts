import { createNewItem, deletePage, renamePage, movePage } from "@/services/editor-actions";
import { setupNavListeners } from "@/features/navigation";
import { addRecent } from "@/utils/recent-files";
import { storageService } from "@/services/storage";
import { getProvider, switchProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { openProviderDialog } from "@/controllers/dialog/provider-dialog";
import { showNotification } from "@/components/notification/notification";
import { pagesStore } from "@/stores/page-store";
import { pushPath, replacePath } from "@/utils/url";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { PendingOpType } from "@/entities/PendingOps";
import { updateEditorTint, clearEditorTint } from "@/services/file-status-tint";
import { isHugoIndex, isRootPath } from "@/utils/hugo-compat";
import { treeStore } from "@/stores/tree-store";
import { HOME_PATH, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import type { EditorController } from "@/controllers/editor-controller";
import type { FileSyncService } from "@/services/file-sync-service";

export class NavigationService {
  private currentPath: string = "";
  private loading: boolean = false;
  private editor: EditorController;
  private cache: FileSyncService;
  private unsubs: (() => void)[] = [];

  constructor(editor: EditorController, cache: FileSyncService) {
    this.editor = editor;
    this.cache = cache;

    this.unsubs.push(
      appEvents.on(AppEvent.Navigate, ({ path, query, matchIndex, snippetText }) =>
        this.navigate(path, true, query, matchIndex, snippetText),
      ),
      appEvents.on(AppEvent.SidebarNewItemRequested, ({ parentPath, isFolder }) =>
        createNewItem(this.cache, parentPath, (p) => this.navigate(p), () => this.loadSidebar(), isFolder),
      ),
      appEvents.on(AppEvent.SidebarDeleteRequested, ({ path }) => this.deletePage(path)),
      appEvents.on(AppEvent.SidebarRenameRequested, ({ path }) => this.renamePage(path)),
      appEvents.on(AppEvent.SidebarMoveRequested, ({ from, to }) => this.movePage(from, to)),
    );
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
  }

  async navigate(path: string, pushHistory = true, searchQuery?: string, matchIndex?: number, snippetText?: string): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      dirtyTrackingService.flush();

      this.currentPath = path;
      clearEditorTint(this.editor.element as HTMLElement);
      updateEditorTint(this.editor.element as HTMLElement, path, this.cache.getPendingOps());
      appEvents.emit(AppEvent.ViewChanged, { view: "editor" });
      this.editor.setCurrentPath(path);
      this.cache.setCurrentPath(path);
      this.editor.showSkeleton();

      if (pushHistory) {
        pushPath(path);
      }

      const sourceEl = this.editor.sourceTarget;
      const editorEl = this.editor.milkdownTarget;
      if (sourceEl && editorEl) {
        sourceEl.style.display = "none";
        editorEl.style.display = "block";
      }

      const ops = this.cache.getPendingOps();
      const moveOp = ops.all.find(o => o.type === PendingOpType.Move && o.to === path) as
        | { type: PendingOpType.Move; from: string; to: string }
        | undefined;
      const effectivePath = moveOp ? moveOp.from : path;
      const rawContent = await this.editor.fetchContent(effectivePath, () => appEvents.emit(AppEvent.MetaPanelReload));

      if (rawContent === null) {
        const dirIndex = isHugoIndex(path);
        if (dirIndex) {
          this.editor.hideSkeleton()
          appEvents.emit(AppEvent.DirIndexEmpty, { path });
          await this.loadSidebar();
          dirtyTrackingService.recompute();
        } else {
          this.editor.hideSkeleton()
          appEvents.emit(AppEvent.NoFileView, { lastPath: path });
        }
        return;
      }

      const content = rawContent;
      const dirIndexEmpty = isHugoIndex(path) && !content.trim();

      if (dirIndexEmpty) {
        appEvents.emit(AppEvent.DirIndexEmpty, { path });
        await this.loadSidebar();
        dirtyTrackingService.recompute();
        return;
      }

      await this.editor.ensureEditor(content);
      this.editor.hideSkeleton();
      if (searchQuery) {
        requestAnimationFrame(() => {
          this.editor.scrollToText(searchQuery, matchIndex, snippetText);
        });
      }

      appEvents.emit(AppEvent.SidebarActive, { path });
      dirtyTrackingService.recompute();
      addRecent(path);
    } finally {
      this.loading = false;
    }
  }

  async loadSidebar(): Promise<void> {
    try {
      const treeIndex = treeStore.getTree();
      const mergedTree = this.cache.getPendingOps().applyToTree(treeIndex);

      setupNavListeners((path: string) => this.navigate(path));

      const pages = Array.from(mergedTree.paths);
      this.editor.getMentionView()?.setPages(pages, {});
      appEvents.emit(AppEvent.SidebarReload);
    } catch (error) {
      console.error("Failed to load sidebar:", error);
    }
  }

  async changeProvider(): Promise<void> {
    const current = getProvider();
    const result = await openProviderDialog(current.name);

    if (!result) return;

    if (result.type === current.name && !result.configChanged) return;

    try {
      pagesStore.clearAll();

      await switchProvider(result.type);
      const providerId = String(getProvider().name)
      const files = storageService.loadProviderFiles(providerId)
      appEvents.emit(AppEvent.ProviderFilesLoaded, files)

      await this.loadSidebar();
      dirtyTrackingService.recompute();

      const pages = Array.from(treeStore.getTree().paths);
      const home = resolveHomePageFromPaths(pages);
      if (home) {
        this.navigate(home);
      } else {
        appEvents.emit(AppEvent.NoFileView, {});
      }

      const pdi = getProviderDisplayInfo(result.type);
      showNotification(`Switched to ${pdi.label}`, { type: "info" });
    } catch (error) {
      console.error("Failed to change provider:", error);
    }
  }

  async deletePage(pagePath: string): Promise<void> {
    const indexPath = pagePath + "/" + HOME_PATH;
    const openPath = this.currentPath;
    const isRecursive = openPath === pagePath || openPath.startsWith(pagePath + "/");
    const openHadPendingCreate = isRecursive && this.cache.getPendingOps().all.some(
      o => o.type === PendingOpType.Create && o.path === openPath
    );
    await deletePage(this.cache, pagePath, () => {
      pagesStore.clearPath(pagePath);
      if (indexPath !== pagePath) pagesStore.clearPath(indexPath);
      if (openHadPendingCreate) {
        appEvents.emit(AppEvent.NoFileView, { lastPath: pagePath });
      } else if (isRecursive) {
        updateEditorTint(this.editor.element as HTMLElement, openPath, this.cache.getPendingOps());
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }

  async renamePage(pagePath: string): Promise<void> {
    await renamePage(this.cache, pagePath, (newPath) => {
      if (newPath == null) return;
      pagesStore.clearPath(pagePath);
      this.loadSidebar();
      dirtyTrackingService.recompute();
    }, async (slug, parentDir) => {
      if (slug === HOME_PATH) {
        const tree = treeStore.getTree();
        const targetPath = parentDir ? `${parentDir}/${HOME_PATH}` : HOME_PATH;
        if (tree.paths.has(targetPath)) {
          return `"${HOME_PATH}.md" already exists in this directory.`;
        }
      }
      return null;
    });
  }

  async movePage(from: string, to: string): Promise<void> {
    await movePage(this.cache, from, to, () => {
      pagesStore.clearPath(from);
      pagesStore.clearPath(to);
      if (this.currentPath === from) {
        this.navigate(to);
        replacePath(to);
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }
}
