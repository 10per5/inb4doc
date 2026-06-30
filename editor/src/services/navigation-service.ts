/**
 * NavigationService
 * 
 * Manages page navigation, sidebar loading, and page operations
 * Handles navigation state and provider switching
 */

import { stripFrontmatter } from "../utils/frontmatter";
import { createNewItem, deletePage, renamePage, movePage } from "../editor-actions";
import { setupNavListeners, collectPageList } from "../features/navigation";
import { getProvider, setProvider, cacheKeyForProvider, getProviderDisplayInfo } from "../content/provider-registry";
import { createProviderByType } from "../content";
import { mountSidebar, type SidebarActions, type TreeNode } from "../components/panels/sidebar";
import { mountProviderDialog } from "../components/dialogs/provider-dialog";
import { showToast } from "../components/toast/toast";
import { cache } from "../cache";
import { editorSelfBase } from "../config";
import { pushPath, replacePath } from "../utils/url";
import type { CacheManagementService } from "./cache-management-service";
import type { PendingOp } from "../utils/tree";

function existsInTree(tree: TreeNode, mdPath: string): boolean {
  const parts = mdPath.split("/");
  let node: TreeNode | null | undefined = tree;
  for (const part of parts) {
    if (!node || typeof node !== "object") return false;
    node = node[part] as TreeNode | null | undefined;
  }
  return node !== undefined;
}

export interface NavigationCallbacks {
  onBeforeNavigate?: (path: string) => void;
  onNavigate?: (path: string) => void;
  onContentNeeded?: (path: string) => Promise<string>;
  onContentReady?: (path: string, content: string) => Promise<void>;
  onSidebarReload?: () => Promise<void>;
  onProviderChanged?: (type: string) => void;
  onPageDeleted?: () => void;
  onPageRenamed?: () => void;
  onPageMoved?: () => void;
  onUpdateUI?: () => void;
  onSearchNavigate?: (query: string, matchIndex?: number, snippetText?: string) => void;
}

export class NavigationService {
  private currentPath: string = "";
  private loading: boolean = false;
  private emptyTreePrompted: boolean = false;
  private callbacks: NavigationCallbacks;
  private cacheService!: CacheManagementService;

  constructor(callbacks: NavigationCallbacks = {}) {
    this.callbacks = callbacks;
  }

  setCacheService(service: CacheManagementService): void {
    this.cacheService = service;
  }

  /**
   * Get current path
   */
  getCurrentPath(): string {
    return this.currentPath;
  }

  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  /**
   * Check if navigation is in progress
   */
  isLoading(): boolean {
    return this.loading;
  }

  /**
   * Navigate to a page
   */
  async navigate(path: string, pushHistory = true, searchQuery?: string, matchIndex?: number, snippetText?: string): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      this.currentPath = path;
      this.callbacks.onBeforeNavigate?.(path);

      if (pushHistory) {
        pushPath(path);
      }

      // Hide source editor, show WYSIWYG
      const sourceEl = document.getElementById("source-editor");
      const editorEl = document.getElementById("milkdown-editor");
      if (sourceEl && editorEl) {
        sourceEl.style.display = "none";
        editorEl.style.display = "block";
      }

      // Fetch and load content
      const content = await this.callbacks.onContentNeeded?.(path);
      if (content) {
        await this.callbacks.onContentReady?.(path, content);
        this.callbacks.onNavigate?.(path);
        if (searchQuery) {
          requestAnimationFrame(() => {
            this.callbacks.onSearchNavigate?.(searchQuery, matchIndex, snippetText);
          });
        }
      }

      // Reload sidebar
      await this.callbacks.onSidebarReload?.();
      this.callbacks.onUpdateUI?.();
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load and render sidebar
   */
  async loadSidebar(
    onNavigate: (path: string, searchQuery?: string, matchIndex?: number, snippetText?: string) => void,
    onUpdateMention?: (pages: string[], meta: any) => void
  ): Promise<void> {
    const sidebarEl = document.getElementById("sidebar-nav");
    if (!sidebarEl) return;

    try {
      const provider = getProvider();
      const sidebarCache: TreeNode = (await provider?.getTree()) ?? {};

      // Prompt to change provider if tree is empty on first load
      if (
        !this.emptyTreePrompted &&
        Object.keys(sidebarCache).length === 0 &&
        provider.name === "remote"
      ) {
        this.emptyTreePrompted = true;
        await this.changeProvider();
        return;
      }

      // Build display tree with pending ops applied
      const displayTree = this.cacheService.applyPendingOpsToTree(sidebarCache);
      const pendingOps: PendingOp[] = this.cacheService.getPendingOps();
      const dirtyPaths = cache.getDirtyPaths();

      const actions: SidebarActions = {
        onNavigate: (path, searchQuery, matchIndex, snippetText) => onNavigate(path, searchQuery, matchIndex, snippetText),
        onNewItem: (parentPath) =>
          createNewItem(this.cacheService, parentPath, (p) => onNavigate(p), () => this.loadSidebar(onNavigate, onUpdateMention)),
        onDelete: (path) => this.deletePage(path, onNavigate),
        onRename: (path) => this.renamePage(path, onNavigate),
        onMove: (from, to) => this.movePage(from, to, onNavigate),
        onChangeProvider: () => this.changeProvider(),
      };

      const pdi = getProviderDisplayInfo(provider.name);
      mountSidebar(sidebarEl, displayTree, this.currentPath, actions, pdi.icon, pdi.label, provider.name, pendingOps, dirtyPaths, sidebarCache);
      setupNavListeners((path: string) => onNavigate(path));

      const pages = collectPageList(displayTree);
      onUpdateMention?.(pages, {});
    } catch (error) {
      console.error("Failed to load sidebar:", error);
    }
  }

  /**
   * Change content provider
   */
  async changeProvider(): Promise<void> {
    const current = getProvider();
    const result = await mountProviderDialog(current.name);

    if (!result || result.type === current.name) return;

    try {
      cache.saveState(cacheKeyForProvider(current.name));
      cache.clearAll();
      cache.sync();

      const newProvider = createProviderByType(result.type);
      setProvider(newProvider);
      cache.restoreState(cacheKeyForProvider(result.type));

      this.callbacks.onProviderChanged?.(result.type);
      await this.callbacks.onSidebarReload?.();
      this.callbacks.onUpdateUI?.();

      const pdi = getProviderDisplayInfo(result.type);
      showToast(`Switched to ${pdi.label}`);
    } catch (error) {
      console.error("Failed to change provider:", error);
    }
  }

  /**
   * Delete a page
   */
  async deletePage(pagePath: string, onNavigate: (path: string) => void): Promise<void> {
    await deletePage(this.cacheService, pagePath, () => {
      cache.clearPath(pagePath);
      cache.sync();

      if (this.currentPath === pagePath) {
        onNavigate("_index");
      } else {
        this.callbacks.onSidebarReload?.();
      }

      this.callbacks.onPageDeleted?.();
      this.callbacks.onUpdateUI?.();
      this.cacheService.updateDirtyCounter();
    });
  }

  /**
   * Rename a page
   */
  async renamePage(pagePath: string, onNavigate: (path: string) => void): Promise<void> {
    await renamePage(this.cacheService, pagePath, (newPath) => {
      if (newPath == null) return;

      cache.clearPath(pagePath);
      cache.sync();

      if (this.currentPath === pagePath) {
        onNavigate(newPath);
      } else {
        this.callbacks.onSidebarReload?.();
      }

      this.callbacks.onPageRenamed?.();
      this.callbacks.onUpdateUI?.();
      this.cacheService.updateDirtyCounter();
    }, async (slug, parentDir) => {
      if (slug === "_index") {
        const provider = getProvider();
        const tree = await provider?.getTree();
        if (tree) {
          const targetPath = parentDir ? `${parentDir}/_index.md` : "_index.md";
          if (existsInTree(tree, targetPath)) {
            return `"_index.md" already exists in this directory.`;
          }
        }
      }
      return null;
    });
  }

  /**
   * Move a page
   */
  async movePage(from: string, to: string, onNavigate: (path: string) => void): Promise<void> {
    await movePage(this.cacheService, from, to, () => {
      cache.clearPath(from);
      cache.sync();

      if (this.currentPath === from) {
        onNavigate(to);
        replacePath(to);
      }

      this.callbacks.onPageMoved?.();
      this.callbacks.onSidebarReload?.();
      this.callbacks.onUpdateUI?.();
      this.cacheService.updateDirtyCounter();
    });
  }

  /**
   * Reset state
   */
  reset(): void {
    this.currentPath = "";
    this.loading = false;
    this.emptyTreePrompted = false;
  }
}
