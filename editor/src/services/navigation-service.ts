import {
  createNewItem,
  deletePages,
  duplicatePages,
  clearPageContents,
  cutPage,
  pastePage,
  renamePage,
  renameFolder,
  movePage,
  setPageWeights,
} from "@/features/editor-actions";
import { setupNavListeners } from "@/features/navigation";
import { addRecent } from "@/utils/recent-files";
import { storageService } from "@/services/storage-service";
import { getProvider, switchProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { showNotification } from "@/components/notification/notification";
import { pagesStore } from "@/stores/page-store";
import { pushPath, replacePath, takeAdoptedDocumentPath } from "@/utils/url";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { PendingOpType } from "@/entities/PendingOps";
import { updateEditorTint, clearEditorTint } from "@/utils/file-status-tint";
import { isHugoIndex, isRootPath } from "@/utils/hugo-compat";
import { resolveProjectEntryPath, isPathInScope } from "@/features/project-entry";
import { prefsStore } from "@/stores/preferences-store";
import { treeStore } from "@/stores/tree-store";
import { HOME_PATH, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import type { EditorController } from "@/controllers/editor-controller";
import type { FileSyncService } from "@/services/file-sync-service";
import { imageService } from "@/services/image-service";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { pickProjectDirectory } from "@/bridge/native";
import { recentProjectsStore } from "@/stores/recent-projects-store";
import { confirmDialog } from "@/controllers/dialog/dialog";

/**
 * Re-key the cached page for a rename instead of dropping it.
 *
 * A pending Create has no file on disk yet, so its parsed frontmatter and
 * baseline live only in `pagesStore`. Clearing both keys here made the first
 * save of a renamed new page write its body without frontmatter.
 */
function movePageState(from: string, to: string): void {
  const page = pagesStore.get(from);
  pagesStore.clearPath(to);
  if (!page) return;
  const next = pagesStore.getOrCreate(to);
  if (page.bodyState.body !== undefined) {
    next.bodyState.cacheBody(page.bodyState.body);
  }
  if (page.bodyState.baseline !== undefined) {
    next.bodyState.setBaseline(page.bodyState.baseline);
  }
  next.frontmatter = page.frontmatter;
  next.originalFrontmatter = page.originalFrontmatter;
  const serverTime = page.getServerTime();
  if (serverTime !== undefined) next.setServerTime(serverTime);
  pagesStore.clearPath(from);
}

export class NavigationService {
  private currentPath: string = "";
  private activeProjectRoot: string = "";
  private loading: boolean = false;
  private editor: EditorController;
  private cache: FileSyncService;
  private unsubs: (() => void)[] = [];
  private navCleanup: (() => void) | null = null;

  constructor(editor: EditorController, cache: FileSyncService) {
    this.editor = editor;
    this.cache = cache;

    this.unsubs.push(
      appEvents.on(AppEvent.Navigate, ({ path, query, matchIndex, snippetText }) =>
        this.navigate(path, true, query, matchIndex, snippetText),
      ),
      // Browser Back/Forward between documents: the URL already points at the
      // target, so load it without pushing a duplicate history entry.
      appEvents.on(AppEvent.HistoryNavigate, ({ path }) => this.navigate(path, false)),
      appEvents.on(AppEvent.SidebarNewItemRequested, ({ parentPath, isFolder }) =>
        createNewItem(this.cache, parentPath, (p) => this.navigate(p), () => this.loadSidebar(), isFolder),
      ),
      appEvents.on(AppEvent.SidebarDeleteRequested, ({ paths }) => this.deletePages(paths)),
      appEvents.on(AppEvent.SidebarRenameRequested, ({ path }) => this.renamePage(path)),
      appEvents.on(AppEvent.SidebarMoveRequested, ({ from, to }) => this.movePage(from, to)),
      appEvents.on(AppEvent.FileCutRequested, ({ path }) => this.cutPage(path)),
      appEvents.on(AppEvent.FilePasteRequested, ({ target }) => this.pastePage(target)),
      appEvents.on(AppEvent.SidebarDuplicateRequested, ({ paths }) =>
        this.duplicatePages(paths),
      ),
      appEvents.on(AppEvent.SidebarClearContentRequested, ({ paths }) =>
        this.clearPageContents(paths),
      ),
      appEvents.on(AppEvent.SidebarWeightsRequested, ({ weights }) =>
        setPageWeights(this.cache, weights, () => {
          this.loadSidebar();
        }),
      ),
      // Switching projects (root scope) only retargets the sidebar — the open
      // document stayed put and, once it fell outside the new scope, the editor
      // was left on someone else's page. Land on that project's own document
      // instead: where you left off there, else the first page with content.
      appEvents.on(AppEvent.RootScopeChanged, () => {
        void this.restoreProjectEntry();
      }),
    );
  }

  /**
   * Opens the document belonging to the active project after a switch.
   *
   * A scope change is only a *switch* when the open document falls outside the
   * new scope — switching to a broader scope (or to the one holding the current
   * page) keeps context, so nothing is reloaded.
   */
  private async restoreProjectEntry(): Promise<void> {
    const scope = prefsStore.rootScope;
    if (isPathInScope(this.currentPath, scope)) return;

    const entry = await resolveProjectEntryPath(scope, this.cache.getPendingOps());
    if (!entry) {
      this.editor.hideSkeleton();
      appEvents.emit(AppEvent.NoFileView, { lastPath: this.currentPath });
      return;
    }
    await this.navigate(entry);
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  /**
   * The content root currently mounted. Remembered so switching projects can
   * first record which document was open here, then restore the one belonging
   * to the project being switched to.
   */
  setActiveProject(rootPath: string): void {
    if (!rootPath) return;
    this.activeProjectRoot = rootPath;
  }

  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    this.navCleanup?.();
    this.navCleanup = null;
  }

  async navigate(path: string, pushHistory = true, searchQuery?: string, matchIndex?: number, snippetText?: string): Promise<void> {
    if (this.loading) {
      // Drop a stale adoption from an aborted navigation.
      takeAdoptedDocumentPath();
      return;
    }
    this.loading = true;

    try {
      dirtyTrackingService.flush();

      const samePath = path === this.currentPath;
      this.currentPath = path;
      clearEditorTint(this.editor.element as HTMLElement);
      updateEditorTint(this.editor.element as HTMLElement, path, this.cache.getPendingOps());
      appEvents.emit(AppEvent.ViewChanged, { view: "editor", reason: "document" });
      // Opening a document from a fullview adopts that entry (the shell marks
      // it during the emit above); a normal switch pushes a new one.
      const adoptedEntry = takeAdoptedDocumentPath();
      this.editor.setCurrentPath(path);
      this.cache.setCurrentPath(path);

      if (samePath) {
        appEvents.emit(AppEvent.SidebarActive, { path });
        if (this.cache.getPendingOps().findCreate(path)) {
          // The file was just created for the already-open path (empty-dir
          // index template, first page, sidebar "New" on an empty dir). The
          // same-path early return would leave the editor showing the previous
          // document, so the draft the user sees and edits would never match
          // what is queued to be created — load it now.
          await this.editor.loadContent(
            path,
            () => appEvents.emit(AppEvent.MetaPanelReload)
          );
        }
        dirtyTrackingService.recompute();
        addRecent(path);
        return;
      }

      this.editor.showSkeleton();

      if (pushHistory) {
        if (adoptedEntry) replacePath(path);
        else pushPath(path);
      }

      const sourceEl = this.editor.sourceTarget;
      const editorEl = this.editor.inb4docTarget;
      if (sourceEl && editorEl) {
        sourceEl.style.display = "none";
        editorEl.style.display = "";
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
          appEvents.emit(AppEvent.SidebarActive, { path });
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
        appEvents.emit(AppEvent.SidebarActive, { path });
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

      this.navCleanup?.();
      this.navCleanup = setupNavListeners((path: string) => this.navigate(path));

      appEvents.emit(AppEvent.SidebarReload);
    } catch (error) {
      console.error("Failed to load sidebar:", error);
    }
  }

  /** Runtime directory reselection: switch the active provider to a new content root. */
  async openProject(path?: string): Promise<void> {
    if (this.loading) return;
    if (!hasFunc(AppFunc.ProjectPicker)) return;

    const provider = getProvider();
    if (!provider.setRoot) return;

    let targetPath = path;
    if (!targetPath) {
      const info = await pickProjectDirectory();
      if (!info) return; // user cancelled — stay put, silently
      targetPath = info.path;
    }

    // Hand the outgoing project its "you were here" marker before the root
    // changes — afterwards there is no way to attribute it.
    if (this.activeProjectRoot) {
      recentProjectsStore.setLastFile(this.activeProjectRoot, this.currentPath);
    }

    const ops = this.cache.getPendingOps();
    if (ops.all.length > 0) {
      const confirmed = await confirmDialog({
        title: "Switch project?",
        message:
          `Opening another project will discard ${ops.all.length} pending change` +
          `${ops.all.length === 1 ? "" : "s"} that have not been flushed to disk. Continue?`,
        confirmLabel: "Switch Project",
        confirmClass: "danger",
      });
      if (!confirmed) return;
    }

    this.loading = true;
    try {
      this.editor.showSkeleton();
      clearEditorTint(this.editor.element as HTMLElement);
      // Fold editor-local edits into pending ops, then discard everything so no
      // stale ops from the old root survive the switch.
      dirtyTrackingService.flush();
      pagesStore.clearAll();
      this.cache.clearPendingOps();
      // Drop the image cache so the old root's pending/committed images don't
      // leak into the newly opened directory (ImageService keys both maps by
      // relative dir, so entries from the previous root would otherwise
      // resurface under the same relative paths).
      await imageService.clearAll();

      await provider.setRoot(targetPath);
      recentProjectsStore.add(targetPath);
      treeStore.setTree(await provider.getTree());
    } catch (error) {
      console.error("Failed to open project:", error);
      showNotification("Failed to switch project", { type: "danger" });
      return;
    } finally {
      this.loading = false;
    }

    this.activeProjectRoot = targetPath;

    await this.loadSidebar();
    dirtyTrackingService.recompute();

    const pages = Array.from(treeStore.getTree().paths);
    // A project remembers its own last document: switching back continues where
    // you left off instead of dumping you on the home page. Only honoured when
    // that file still exists — otherwise the usual home/no-file fallback runs.
    const remembered = recentProjectsStore.getLastFile(targetPath);
    const home = resolveHomePageFromPaths(pages);
    const start = remembered && pages.includes(remembered) ? remembered : home;
    // Reset so navigate() reloads even when the new root's start equals the
    // previously open path (otherwise the old root's document would stay in
    // the editor and could be saved into the new root).
    this.currentPath = "";
    if (start) {
      await this.navigate(start);
    } else {
      this.editor.hideSkeleton();
      appEvents.emit(AppEvent.NoFileView, {});
    }
  }

  async changeProvider(): Promise<void> {
    const current = getProvider();
    const { openProviderWindow } = await import("@/controllers/dialog/provider-dialog");
    const result = await openProviderWindow(current.name);

    if (!result) return;

    if (result.type === current.name && !result.configChanged) return;

    try {
      // Commit any debounced edits to the current provider's pending ops. This
      // also clears the body timers, so nothing later writes the old ops under
      // the new provider's storage prefix.
      dirtyTrackingService.flush();

      pagesStore.clearAll();
      // The root is only meaningful within one provider/backend.
      this.activeProjectRoot = "";

      await switchProvider(result.type);

      // Rebuild pending ops from the *new* provider's storage. The in-memory
      // ops are keyed by path only; carrying them over would flush edits and
      // deletes queued for the old provider into the new one.
      this.cache.reloadPendingOps();

      const providerId = String(getProvider().name)
      const files = storageService.loadProviderFiles(providerId)
      appEvents.emit(AppEvent.ProviderFilesLoaded, files)

      await this.loadSidebar();
      dirtyTrackingService.recompute();

      // Reset the current path so navigate() reloads even when the new
      // provider's home equals the previously open path. Otherwise the editor
      // keeps showing the old provider's document and a save would write it
      // into the new provider's file.
      this.currentPath = "";
      const pages = Array.from(treeStore.getTree().paths);
      const home = resolveHomePageFromPaths(pages);
      if (home) {
        await this.navigate(home);
      } else {
        this.editor.hideSkeleton();
        appEvents.emit(AppEvent.NoFileView, {});
      }

      const pdi = getProviderDisplayInfo(result.type);
      showNotification(`Switched to ${pdi.label}`, { type: "info" });
    } catch (error) {
      console.error("Failed to change provider:", error);
    }
  }

  async deletePages(pagePaths: string[]): Promise<void> {
    const openPath = this.currentPath;
    const affected = pagePaths.find(p => openPath === p || openPath.startsWith(p + "/"));
    const openHadPendingCreate = !!affected && this.cache.getPendingOps().all.some(
      o => o.type === PendingOpType.Create && o.path === openPath
    );
    await deletePages(this.cache, pagePaths, () => {
      for (const pagePath of pagePaths) {
        pagesStore.clearPath(pagePath);
        const indexPath = pagePath + "/" + HOME_PATH;
        if (indexPath !== pagePath) pagesStore.clearPath(indexPath);
      }
      if (openHadPendingCreate) {
        appEvents.emit(AppEvent.NoFileView, { lastPath: affected });
      } else if (affected) {
        updateEditorTint(this.editor.element as HTMLElement, openPath, this.cache.getPendingOps());
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }

  /**
   * Duplicate one or more rows (a folder copies itself and everything under
   * it). The copies are pending Creates — nothing lands on disk until a flush.
   */
  async duplicatePages(paths: string[]): Promise<void> {
    await duplicatePages(this.cache, paths, (created) => {
      this.loadSidebar();
      dirtyTrackingService.recompute();
      showNotification(
        `Duplicated ${created.length} item${created.length === 1 ? "" : "s"} — flush to write`,
        { type: "info", id: "duplicate" },
      );
    });
  }

  /**
   * Ctrl+X in the explorer: the page's contents move to the file clipboard and
   * the page itself becomes a pending Delete, so the row survives (struck
   * through) until a paste re-homes it or a flush commits the delete.
   */
  async cutPage(path: string): Promise<void> {
    await cutPage(this.cache, path, () => {
      updateEditorTint(this.editor.element as HTMLElement, path, this.cache.getPendingOps());
      this.loadSidebar();
      dirtyTrackingService.recompute();
    });
  }

  /**
   * Ctrl+V in the explorer: rebuild the cut document next to (or inside) the
   * target row and open the fresh page. The original's pending Delete stays
   * queued, so one flush performs the whole move.
   */
  async pastePage(target: string): Promise<void> {
    await pastePage(this.cache, target, (created) => {
      this.loadSidebar();
      dirtyTrackingService.recompute();
      this.navigate(created);
    });
  }

  /**
   * Empty a page's body (a folder's `_index`). Pending Edit, so the change is
   * reviewable and reversible until the next flush. Clearing the open document
   * also re-renders the editor — a flush/reload would otherwise resurrect the
   * on-disk body, since the cleared body exists only as a pending patch.
   */
  async clearPageContents(paths: string[]): Promise<void> {
    await clearPageContents(this.cache, paths, (cleared) => {
      if (cleared.includes(this.currentPath)) {
        this.editor.ensureEditor("");
      }
      this.loadSidebar();
      dirtyTrackingService.recompute();
      appEvents.emit(AppEvent.MetaPanelReload);
      showNotification(
        `Cleared ${cleared.length} page${cleared.length === 1 ? "" : "s"} — flush to write`,
        { type: "info", id: "clear-content" },
      );
    });
  }

  /**
   * Rename without asking — used by auto-naming, where the first `# heading`
   * supplies the name. Returns false when the target is empty, unchanged, or
   * already taken (an inferred name must never clobber an existing file);
   * the caller keeps the old path and can retry on a later save.
   */
  async renameTo(from: string, to: string): Promise<boolean> {
    if (!from || !to || from === to) return false
    if (await this.cache.pathExists(to)) return false
    // Another unsaved draft may already own the target: a Create that only
    // exists in pending ops would otherwise be overwritten by the move.
    const ops = this.cache.getPendingOps()
    if (ops.hasPendingCreate(to) || ops.hasPendingMoveTo(to)) return false
    this.cache.queueRename(from, to)
    movePageState(from, to)
    if (this.currentPath === from) {
      this.currentPath = to
      this.editor.setCurrentPath(to)
      this.cache.setCurrentPath(to)
      replacePath(to)
    }
    await this.loadSidebar()
    dirtyTrackingService.recompute()
    return true
  }

  async renamePage(pagePath: string): Promise<void> {
    const tree = this.cache.getPendingOps().applyToTree(treeStore.getTree());
    const parentDir = pagePath.includes("/")
      ? pagePath.substring(0, pagePath.lastIndexOf("/"))
      : "";
    const isFolder = (tree.children.get(parentDir) ?? []).some(
      (child) => child.isDir && child.path === pagePath,
    );

    if (isFolder) {
      const openPath = this.currentPath;
      const openWasPendingCreate = this.cache
        .getPendingOps()
        .all.some((op) => op.type === PendingOpType.Create && op.path === openPath);
      const openInsideFolder =
        openPath === pagePath || openPath.startsWith(`${pagePath}/`);

      await renameFolder(this.cache, pagePath, (newPath) => {
        if (newPath == null) return;
        // A not-yet-created page has no file to rename; its Create moved with
        // the folder, so move the editor with it as well. Existing files keep
        // their old (still readable) path until the flush emits Navigate.
        if (openWasPendingCreate && openInsideFolder) {
          const newCurrent = `${newPath}${openPath.slice(pagePath.length)}`;
          movePageState(openPath, newCurrent);
          this.currentPath = newCurrent;
          this.editor.setCurrentPath(newCurrent);
          this.cache.setCurrentPath(newCurrent);
          replacePath(newCurrent);
        } else if (openInsideFolder && openPath !== pagePath) {
          // A directory's `_index` may not exist on disk (empty folder view);
          // there is no Rename op to follow it, so retarget the virtual index
          // path now.
          const covered = this.cache.getPendingOps().all.some(
            (op) =>
              (op.type === PendingOpType.Rename && op.from === openPath) ||
              (op.type === PendingOpType.Create && op.path === openPath) ||
              (op.type === PendingOpType.Move && op.from === openPath),
          );
          if (!covered) {
            const newCurrent = `${newPath}${openPath.slice(pagePath.length)}`;
            if (pagesStore.get(openPath)) movePageState(openPath, newCurrent);
            this.currentPath = newCurrent;
            this.editor.setCurrentPath(newCurrent);
            this.cache.setCurrentPath(newCurrent);
            replacePath(newCurrent);
          }
        }
        // Keep existing cached page state at the old paths until the flush
        // moves the files; edits queued meanwhile fold into the Rename ops.
        this.loadSidebar();
        dirtyTrackingService.recompute();
      });
      return;
    }

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
