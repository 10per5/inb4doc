/**
 * NavigationController — manages page navigation and content loading.
 *
 * Navigation state (path, loading) and content orchestration.
 * Sidebar mounting and page CRUD are delegated to their respective modules.
 */

import { createNewItem, deletePage, renamePage, movePage } from "@/services/editor-actions";
import { setupNavListeners, collectPageList } from "@/features/navigation";
import { addRecent } from "@/utils/recent-files";
import { getProvider, switchProvider, cacheKeyForProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import type SidebarController from "@/controllers/sidebar-controller";
import { type SidebarActions, type TreeNode } from "@/components/panels/sidebar";
import { openProviderDialog } from "@/components/dialogs/provider-dialog";
import { showNotification } from "@/components/notification/notification";
import { pageRepository } from "@/repositories/pageRepository";
import { pushPath, replacePath } from "@/utils/url";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { flushSave } from "@/stores/persistence";
import { PendingOpType } from "@/entities/PendingOps";
import { isHugoIndex } from "@/utils/hugo-compat";
import { treeStore } from "@/stores/tree-store";
import { HOME_PATH, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import type { EditorController } from "@/controllers/editor-controller";
import type { FileSyncController } from "@/controllers/file-sync-controller";
import type { MetaPanelAPI } from "@/components/panels/meta-panel";

function existsInTree(tree: TreeNode, mdPath: string): boolean {
  const parts = mdPath.split("/");
  let node: TreeNode | null | undefined = tree;
  for (const part of parts) {
    if (!node || typeof node !== "object") return false;
    node = node[part] as TreeNode | null | undefined;
  }
  return node !== undefined;
}

export class NavigationController {
  private currentPath: string = "";
  private loading: boolean = false;
  private editor: EditorController;
  private cache: FileSyncController;
  private sidebarEl: HTMLElement;
  private sidebarController: SidebarController;
  private metaPanel: MetaPanelAPI | undefined;
  private unsubs: (() => void)[] = [];

  constructor(editor: EditorController, cache: FileSyncController, sidebarEl: HTMLElement, sidebarController: SidebarController) {
    this.editor = editor;
    this.cache = cache;
    this.sidebarEl = sidebarEl;
    this.sidebarController = sidebarController;

    this.unsubs.push(
      appEvents.on(AppEvent.Navigate, ({ path }) => this.navigate(path)),
    );
  }

  setMetaPanel(panel: MetaPanelAPI): void {
    this.metaPanel = panel;
  }

  getMetaPanel(): MetaPanelAPI | undefined {
    return this.metaPanel;
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
      // Persist any pending debounced body edits + flush cache before leaving
      // the current file, so fast navigation never drops the last edits.
      dirtyTrackingService.flush();
      flushSave();

      this.currentPath = path;
      (this.editor.element as HTMLElement).classList.remove("pending-delete-tint");
      appEvents.emit(AppEvent.ViewChanged, { view: "editor" as any });
      this.editor.setCurrentPath(path);
      this.cache.setCurrentPath(path);

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
      const rawContent = await this.editor.fetchContent(effectivePath, (data) => this.metaPanel?.update(data));

      if (!rawContent) {
        appEvents.emit(AppEvent.NoFileView, { lastPath: path });
        return;
      }

      const content = rawContent;
      const dirIndex = isHugoIndex(path);

      await this.editor.ensureEditor(content);
      this.editor.updateDirIndexOverlay(content);
      if (searchQuery) {
        requestAnimationFrame(() => {
          this.editor.scrollToText(searchQuery, matchIndex, snippetText);
        });
      }

      await this.loadSidebar();
      dirtyTrackingService.recompute();
      addRecent(path);
    } finally {
      this.loading = false;
    }
  }

  async loadSidebar(): Promise<void> {
    if (!this.sidebarEl) return;

    try {
      const provider = getProvider();
      const sidebarCache: TreeNode = treeStore.getTree();

      const pendingOps = this.cache.getPendingOps().all;
      const dirtyPaths = pageRepository.getDirtyPaths();

      // Merge pending creates into tree so new unflushed files appear in sidebar
      const mergedTree: TreeNode = { ...sidebarCache };
      for (const op of pendingOps) {
        if (op.type === PendingOpType.Create) {
          const parts = op.path.split("/");
          let node: any = mergedTree;
          for (let i = 0; i < parts.length; i++) {
            const key = i === parts.length - 1 ? parts[i] + ".md" : parts[i];
            if (i === parts.length - 1) {
              if (!(key in node)) node[key] = null;
            } else {
              if (!(key in node) || typeof node[key] !== "object") node[key] = {};
              node = node[key];
            }
          }
        }
      }

      const actions: SidebarActions = {
        onNavigate: (path, query, matchIndex, snippetText) => this.navigate(path, true, query, matchIndex, snippetText),
        onNewItem: (parentPath, isFolder) =>
          createNewItem(this.cache, parentPath, (p) => this.navigate(p), () => this.loadSidebar(), isFolder),
        onDelete: (path) => this.deletePage(path),
        onRename: (path) => this.renamePage(path),
        onMove: (from, to) => this.movePage(from, to),
        onChangeProvider: () => this.changeProvider(),
      };

      const pdi = getProviderDisplayInfo(provider.name);
      this.sidebarController.load({
        tree: mergedTree,
        current: this.currentPath,
        actions,
        providerIcon: pdi.icon,
        providerLabel: pdi.label,
        providerType: provider.name,
        pendingOps,
        dirtyPaths,
      });
      setupNavListeners((path: string) => this.navigate(path));

      const pages = collectPageList(mergedTree);
      this.editor.getMentionView()?.setPages(pages, {});
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
      pageRepository.save(cacheKeyForProvider(current.name));
      pageRepository.clearAll();
      pageRepository.save();

      await switchProvider(result.type);
      pageRepository.load(cacheKeyForProvider(result.type));

      await this.loadSidebar();
      dirtyTrackingService.recompute();

      const pages = collectPageList(treeStore.getTree());
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
    await deletePage(this.cache, pagePath, () => {
      pageRepository.clearPath(pagePath);
      flushSave();
      if (this.currentPath === pagePath) {
        (this.editor.element as HTMLElement).classList.add("pending-delete-tint");
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }

  async renamePage(pagePath: string): Promise<void> {
    await renamePage(this.cache, pagePath, (newPath) => {
      if (newPath == null) return;
      pageRepository.clearPath(pagePath);
      flushSave();
      if (this.currentPath === pagePath) {
        this.navigate(newPath);
      } else {
        this.loadSidebar();
      }
      dirtyTrackingService.recompute();
    }, async (slug, parentDir) => {
      if (slug === HOME_PATH) {
        const tree = treeStore.getTree();
        const targetPath = parentDir ? `${parentDir}/${HOME_PATH}.md` : `${HOME_PATH}.md`;
        if (existsInTree(tree, targetPath)) {
          return `"${HOME_PATH}.md" already exists in this directory.`;
        }
      }
      return null;
    });
  }

  async movePage(from: string, to: string): Promise<void> {
    await movePage(this.cache, from, to, () => {
      pageRepository.clearPath(from);
      pageRepository.clearPath(to);
      flushSave();
      if (this.currentPath === from) {
        this.navigate(to);
        replacePath(to);
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }
}
