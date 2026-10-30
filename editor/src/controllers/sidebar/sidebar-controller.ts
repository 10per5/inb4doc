import { Controller } from "@hotwired/stimulus";
import { editorSelfBase } from "@/config";
import {
  type SidebarActions,
  type RenderContext,
  buildPendingSets,
  renderItems,
  applyResults,
  showMenu,
  closeMenu,
} from "./sidebar";
import {
  WEIGHT_STEP,
  WEIGHT_EXCHANGE_SHIFT,
  type TreeIndex,
  type ChildInfo,
  ancestorDirs,
} from "@/utils/tree";
import {
  folder,
  folderOpen,
  folderMinus,
  folderMinusOpen,
  filterAlt,
  floppyDisk,
  docMagnifyingGlass,
} from "@/eta/icons";
import { searchContent } from "@/features/search/sidebar-search";
import { confirmDialog } from "@/controllers/dialog/dialog";
import { showNotification } from "@/components/notification/notification";
import { appEvents, AppEvent } from "@/stores/app-events";
import renderSidebar from "@/eta/views/controller/sidebar";

import { prefsStore } from "@/stores/preferences-store";
import { PrefsSection } from "@/config/enums/prefs-section";
import { treeStore } from "@/stores/tree-store";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps } from "@/entities/PendingOps";
import { getCurrentPath } from "@/utils/url";
import { HOME_PATH } from "@/utils/hugo-compat";

export default class extends Controller {
  static targets = [
    "inner",
    "search",
    "searchWrapper",
    "newPageBtn",
    "filtersBtn",
    "filterSummary",
    "deleteSelectedBtn",
    "cancelSelectionBtn",
    "pendingRow",
    "pendingCount",
  ];

  declare readonly innerTarget: HTMLElement;
  declare readonly searchTarget: HTMLInputElement;
  declare readonly searchWrapperTarget: HTMLElement;
  declare readonly newPageBtnTarget: HTMLElement;
  declare readonly filtersBtnTarget: HTMLElement;
  declare readonly filterSummaryTarget: HTMLElement;
  declare readonly deleteSelectedBtnTarget: HTMLButtonElement;
  declare readonly cancelSelectionBtnTarget: HTMLButtonElement;
  declare readonly pendingRowTarget: HTMLElement;
  declare readonly pendingCountTarget: HTMLElement;

  private actions: SidebarActions | null = null;
  private tree: TreeIndex | null = null;
  private rawTree: TreeIndex | null = null;
  private collapsedSections = new Map<string, boolean>();
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private currentQuery = "";
  private allPaths: string[] = [];
  private unsubs: (() => void)[] = [];
  private itemByPath = new Map<string, HTMLElement>();
  private activePath = "";
  private prevDirty = new Set<string>();
  private hideEmptyFolders = false;
  private rootScope = "";
  /** Folders opened by the reveal to the current file (see `revealAncestors`). */
  private revealPaths = new Set<string>();

  private dragFromPath = "";
  private dragFromParent = "";
  private dragFromIsDir = false;
  private dragContainer: HTMLElement | null = null;
  private reorderIndicator: HTMLElement | null = null;
  private reorderBelow = "";
  private reorderAbove = "";
  private selectionMode = false;
  private selected = new Set<string>();

  connect() {
    this.unsubs.push(
      appEvents.on(AppEvent.DirtyChanged, ({ count, dirtyPaths }) => {
        this.updateDirtyIndicators(dirtyPaths);
        this.updatePendingRow(count);
      }),
      appEvents.on(AppEvent.SidebarReload, () => {
        this.load();
      }),
      // Navigation preferences (hide empty folders / root project scope) are
      // edited outside the sidebar, in the preferences window. Re-read them
      // and re-render so the tree always matches what the window shows.
      appEvents.on(AppEvent.RootScopeChanged, () => {
        this.hideEmptyFolders = prefsStore.hideEmptyFolders;
        this.rootScope = prefsStore.rootScope;
        this.load();
      }),
      appEvents.on(AppEvent.SidebarActive, ({ path }) => {
        this.activePath = path
        this.setActive(path)
        // Opening a document — including the one a project restores on open —
        // opens just its chain of folders; the rest of the tree stays folded.
        this.revealAncestors(path, false)
      }),
      appEvents.on(AppEvent.SidebarCancel, () => {
        if (this.selectionMode) this.exitSelection();
      }),
      // Multi-select is a mode, not a screen: back leaves the mode first so a
      // press inside it doesn't jump straight out of Files.
      appEvents.on(AppEvent.BackRequested, (request) => {
        if (!this.selectionMode) return;
        this.exitSelection();
        request.handled = true;
      }),
      appEvents.on(AppEvent.SidebarScrollToCurrent, () => {
        // The tree renders collapsed apart from the chain to the open file, so
        // revealing it means opening those parents first — a row inside a
        // collapsed section has no box to scroll to.
        const active = this.activePath || getCurrentPath();
        this.revealAncestors(active, true);
        let el = this.itemByPath.get(this.activePath);
        // When the open file is a directory's _index page, focus the directory
        // section in the explorer instead of the _index leaf item.
        if (this.activePath.endsWith("/_index")) {
          const dirPath = this.activePath.slice(0, -"/_index".length);
          const section = this.innerTarget.querySelector<HTMLElement>(
            `.nav-section[data-nav-path="${CSS.escape(dirPath)}"]`,
          );
          if (section) el = section;
        }
        if (!el) return;
        const scroller = el.closest<HTMLElement>(".sidebar-inner") ?? el.closest<HTMLElement>(".book-leftpanel");
        if (scroller) {
          const sr = el.getBoundingClientRect();
          const cr = scroller.getBoundingClientRect();
          const target = sr.top - cr.top + scroller.scrollTop - (scroller.clientHeight - el.clientHeight) / 2;
          scroller.scrollTop = Math.max(0, target);
        } else {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      })
    );
  }

  private buildActions(): SidebarActions {
    return {
      onNavigate: (path, searchQuery, matchIndex, snippetText) =>
        appEvents.emit(AppEvent.Navigate, {
          path,
          query: searchQuery,
          matchIndex,
          snippetText,
        }),
      onNewItem: (parentPath, isFolder) =>
        appEvents.emit(AppEvent.SidebarNewItemRequested, {
          parentPath,
          isFolder: isFolder ?? false,
        }),
      onDelete: (paths) =>
        appEvents.emit(AppEvent.SidebarDeleteRequested, { paths }),
      onSelect: (path, isFolder) => this.enterSelection(path, isFolder),
      onRename: (path) =>
        appEvents.emit(AppEvent.SidebarRenameRequested, { path }),
      onDuplicate: (paths) =>
        appEvents.emit(AppEvent.SidebarDuplicateRequested, { paths }),
      onClearContent: (paths) =>
        appEvents.emit(AppEvent.SidebarClearContentRequested, { paths }),
      onMove: (from, to) =>
        appEvents.emit(AppEvent.SidebarMoveRequested, { from, to }),
      onReorderWeights: (weights) =>
        appEvents.emit(AppEvent.SidebarWeightsRequested, { weights }),
      onChangeProvider: () => appEvents.emit(AppEvent.ProviderChangeRequested),
    };
  }

  disconnect() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    closeMenu();
  }

  load(): void {
    const prevScroll = this.targets.has("inner")
      ? this.innerTarget.scrollTop
      : 0;
    this.element.innerHTML = renderSidebar({
      filterAlt,
      saveIcon: floppyDisk,
      reviewIcon: docMagnifyingGlass,
    });
    this.hideEmptyFolders = prefsStore.hideEmptyFolders;
    this.rootScope = prefsStore.rootScope;
    document.getElementById("sidebar-skeleton")?.classList.add("is-hidden");
    this.actions = this.buildActions();

    const rawTree = treeStore.getTree();
    const pendingOps = new PendingOps(pendingOpsStore.load());
    const mergedTree = pendingOps.applyToTree(rawTree);
    this.rawTree = rawTree;
    this.tree = mergedTree;

    const current = getCurrentPath();
    // A freshly opened project shows only the folders leading to the document
    // being restored; everything else starts collapsed.
    this.revealPaths = new Set(ancestorDirs(current));

    const treeEmpty = mergedTree.paths.size === 0;

    if (treeEmpty) {
      this.searchWrapperTarget.style.display = "none";
    } else {
      this.searchWrapperTarget.style.display = "";
    }

    const ctx: RenderContext = {
      current,
      basePath: editorSelfBase,
      collapsedSections: this.collapsedSections,
      rawTree,
      pendingSets: buildPendingSets(pendingOps.all),
      pendingOps: pendingOps.all,
      hideEmptyFolders: this.hideEmptyFolders,
      rootScope: this.rootScope,
      selectionMode: this.selectionMode,
      revealPaths: this.revealPaths,
    };

    this.updateFiltersUi();

    this.allPaths = treeEmpty ? [] : Array.from(mergedTree.paths);

    this.innerTarget.innerHTML = treeEmpty
      ? `<div class="sidebar-empty">No files</div>`
      : renderItems(mergedTree, "", 0, ctx);
    this.innerTarget.scrollTop = prevScroll;

    this.itemByPath.clear();
    if (!treeEmpty) {
      for (const el of this.innerTarget.querySelectorAll<HTMLElement>(
        ".nav-item"
      )) {
        const p = el.getAttribute("data-nav-path");
        if (p) this.itemByPath.set(p, el);
      }
    }

    this.updateSelectionUI();

    // Seed the pending-changes row from storage: DirtyChanged arrives after
    // every recompute, but a sidebar mounted later (or a restored session with
    // ops already queued) has to show the nagger with the right count.
    this.updatePendingRow(new PendingOps(pendingOpsStore.load()).count)

    const prevQuery = this.currentQuery;
    this.currentQuery = "";
    this.searchTarget.value = "";
    this.searchTarget.parentElement?.classList.remove("has-value");

    if (prevQuery) {
      this.searchTarget.value = prevQuery;
      this.searchTarget.parentElement?.classList.add("has-value");
      this.updateSearchResults(prevQuery);
    }
  }

  private resetSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.currentQuery = "";
    this.searchTarget.value = "";
    this.searchTarget.parentElement?.classList.remove("has-value");
  }

  // --- Stimulus action methods ---

  onChangeProvider() {
    this.actions?.onChangeProvider();
  }

  // The empty-folders toggle moved into the navigation preferences window;
  // this button now opens that window on the Navigation section. The summary
  // chip reports the active filters so the button is not a mystery meat
  // control when something is filtered out of the tree.
  onOpenFilters() {
    appEvents.emit(AppEvent.PrefsOpened, { section: PrefsSection.Navigation });
  }

  private updateFiltersUi(): void {
    if (!this.targets.has("filtersBtn")) return
    this.filtersBtnTarget.classList.toggle(
      "active",
      this.hideEmptyFolders || this.rootScope !== ""
    );
    const parts: string[] = [];
    if (this.rootScope !== "") {
      parts.push(this.rootScope.includes("/") ? this.rootScope.split("/").pop()! : this.rootScope);
    }
    if (this.hideEmptyFolders) parts.push("no empty");
    this.filterSummaryTarget.textContent = parts.join(" · ");
    this.filtersBtnTarget.title = parts.length
      ? `Filters: ${parts.join(", ")}`
      : "Navigation filters";
  }

  onSearchInput() {
    const q = this.searchTarget.value;
    this.updateSearchResults(q);
    this.searchTarget.parentElement!.classList.toggle("has-value", !!q);
  }

  onSearchClear() {
    this.clearSearch();
  }

  /**
   * "+ New" — same quick-create as File → New, targeting the project scope
   * chosen in Preferences ▸ Navigation (else the vault root). The page lands
   * under a generated slug that the first `# heading` renames. It used to
   * create next to whatever document happened to be open (which, on boot, is
   * whichever page the initial-path resolver picked); use a row's context menu
   * to create inside a specific folder.
   */
  onNewPage() {
    appEvents.emit(AppEvent.NewFileRequested);
  }

  onNavigate(event: Event) {
    event.preventDefault();
    const navLink = (event.currentTarget as HTMLElement).closest(
      ".nav-link"
    ) as HTMLAnchorElement;
    if (!navLink) return;

    if (this.selectionMode) {
      const path =
        navLink.closest(".nav-item")?.getAttribute("data-nav-path") ||
        navLink.closest(".nav-section")?.getAttribute("data-nav-path") ||
        "";
      if (path) this.toggleSelect(path);
      return;
    }

    const linkPath = navLink.getAttribute("data-nav-path");
    const itemPath = navLink
      .closest(".nav-item")
      ?.getAttribute("data-nav-path");
    const path = linkPath || itemPath;
    if (path) this.actions?.onNavigate(path);
  }

  onShowMenu(event: Event) {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const navMore = target.closest(".nav-more") as HTMLElement;
    if (!navMore) return;
    const navItem = navMore.closest(".nav-item");
    const navSection = navMore.closest(".nav-section");
    const path = (navItem || navSection)?.getAttribute("data-nav-path") || "";
    const isFolder = "isFolder" in navMore.dataset;
    if (this.actions) showMenu(navMore, path, this.actions, isFolder);
  }

  onToggleSection(event: Event) {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const sectionToggle = target.closest(".nav-section-toggle") as HTMLElement;
    const sectionTitle = target.closest(".nav-section-title") as HTMLElement;
    const anchor = sectionToggle || sectionTitle;
    if (!anchor) return;
    const section = anchor.closest(".nav-section") as HTMLElement;
    if (!section) return;
    const path = section.getAttribute("data-nav-path") || "";
    const wasCollapsed =
      this.collapsedSections.get(path) ??
      section.classList.contains("collapsed");
    this.collapsedSections.set(path, !wasCollapsed);
    this.setSectionCollapsed(path, !wasCollapsed);
  }

  /**
   * Open the folders on the way to `path`.
   *
   * Navigation reveals softly: a folder the user toggled by hand keeps its
   * state. The reveal shortcut (Ctrl/Cmd+Shift+E) reveals hard — it records
   * the expansion so the next render doesn't fold the folder again.
   */
  private revealAncestors(path: string, force: boolean): void {
    for (const dir of ancestorDirs(path)) {
      if (!force && this.collapsedSections.has(dir)) continue;
      if (force) this.collapsedSections.set(dir, false);
      this.setSectionCollapsed(dir, false);
    }
  }

  private setSectionCollapsed(dirPath: string, collapsed: boolean): void {
    const section = this.innerTarget.querySelector<HTMLElement>(
      `.nav-section[data-nav-path="${CSS.escape(dirPath)}"]`,
    );
    if (!section) return;
    section.classList.toggle("collapsed", collapsed);
    const iconEl = section.querySelector<HTMLElement>(
      ".sidebar-icon-folder, .sidebar-icon-folder-empty",
    );
    if (!iconEl) return;
    const isFolderEmpty = iconEl.classList.contains("sidebar-icon-folder-empty");
    iconEl.innerHTML = collapsed
      ? isFolderEmpty
        ? folderMinus
        : folder
      : isFolderEmpty
        ? folderMinusOpen
        : folderOpen;
  }

  // --- Keyboard navigation ---

  onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;

    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape" && e.target === this.searchTarget) {
        this.clearSearch();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.selectAll();
      return;
    }

    // Ctrl/Cmd+X / V are the explorer's cut & paste: the focused row (or the
    // open document when the tree itself isn't focused) is the target. The
    // editor owns those keys inside the document, so this never leaves the
    // tree's own keydown handler.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "x" || key === "v") {
        const path = this.focusedPath();
        if (!path) return;
        e.preventDefault();
        if (key === "x") {
          appEvents.emit(AppEvent.FileCutRequested, { path });
        } else {
          appEvents.emit(AppEvent.FilePasteRequested, { target: path });
        }
        return;
      }
    }

    const items = this.getVisibleItems();
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement;
    let idx = items.indexOf(current as HTMLAnchorElement);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < 0) idx = -1;
        items[(idx + 1) % items.length].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx < 0) idx = 0;
        items[(idx - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Enter":
        if (idx >= 0) {
          e.preventDefault();
          items[idx].click();
        }
        break;
      case "Delete":
        e.preventDefault();
        if (this.selectionMode && this.selected.size > 0) {
          this.deleteSelected();
        } else if (idx >= 0) {
          this.deleteFocusedItem(items[idx]);
        }
        break;
    }
  }

  // --- Multi-select delete ---

  private enterSelection(path?: string, isFolder?: boolean): void {
    this.selectionMode = true;
    if (path) this.selected.add(path);
    this.load();
  }

  private exitSelection(): void {
    if (!this.selectionMode) return;
    this.selectionMode = false;
    this.selected.clear();
    this.load();
  }

  private toggleSelect(path: string): void {
    if (this.selected.has(path)) {
      this.selected.delete(path);
    } else {
      this.selected.add(path);
    }
    this.updateSelectionUI();
  }

  onDeleteSelected() {
    this.deleteSelected();
  }

  onCancelSelection() {
    this.exitSelection();
  }

  private deleteSelected(): void {
    if (this.selected.size === 0) return;
    const paths = Array.from(this.selected);
    this.exitSelection();
    this.actions?.onDelete(paths);
  }

  private selectAll(): void {
    this.selectionMode = true;
    this.selected.clear();
    for (const a of this.getVisibleItems()) {
      const path =
        a.closest(".nav-item")?.getAttribute("data-nav-path") ||
        a.closest(".nav-section")?.getAttribute("data-nav-path") ||
        "";
      if (path) this.selected.add(path);
    }
    this.load();
  }

  private updateSelectionUI(): void {
    this.innerTarget.classList.toggle("selection-mode", this.selectionMode);

    for (const el of this.innerTarget.querySelectorAll<HTMLElement>(
      ".nav-item, .nav-section"
    )) {
      const path = el.getAttribute("data-nav-path") || "";
      el.classList.toggle("is-selected", this.selected.has(path));
    }
    for (const cb of this.innerTarget.querySelectorAll<HTMLElement>(
      ".sidebar-checkbox"
    )) {
      const host = cb.closest<HTMLElement>(".nav-item, .nav-section");
      const path = host?.getAttribute("data-nav-path") || "";
      const checked = this.selected.has(path);
      cb.textContent = checked ? "☑" : "☐";
      cb.classList.toggle("is-checked", checked);
    }

    if (this.deleteSelectedBtnTarget) {
      this.deleteSelectedBtnTarget.hidden = !this.selectionMode;
      this.deleteSelectedBtnTarget.textContent = `Delete selected (${this.selected.size})`;
    }
    if (this.cancelSelectionBtnTarget) {
      this.cancelSelectionBtnTarget.hidden = !this.selectionMode;
    }
  }

  private deleteFocusedItem(link: HTMLAnchorElement): void {
    // Same path semantics as the "..." overflow Delete: page items use their
    // `.nav-item` path, folder titles delete the folder (`.nav-section`), not
    // its `_index` page.
    const path =
      link.closest(".nav-item")?.getAttribute("data-nav-path") ||
      link.closest(".nav-section")?.getAttribute("data-nav-path") ||
      "";
    if (path) this.actions?.onDelete([path]);
  }

  /** The row the keyboard is on, falling back to the open document. */
  private focusedPath(): string {
    const active = document.activeElement as HTMLElement | null;
    const host = active?.closest?.(".nav-item, .nav-section") as HTMLElement | null;
    return host?.getAttribute("data-nav-path") || this.activePath;
  }

  private getVisibleItems(): HTMLAnchorElement[] {
    const items =
      this.innerTarget.querySelectorAll<HTMLAnchorElement>(".nav-link");
    return Array.from(items).filter(
      (a) =>
        a.offsetParent !== null &&
        (a.closest(".nav-item") as HTMLElement | null)?.style.display !== "none"
    );
  }

  // --- Search ---

  private clearSearch() {
    this.searchTarget.value = "";
    this.updateSearchResults("");
    this.searchTarget.parentElement!.classList.remove("has-value");
    this.searchTarget.focus();
  }

  private updateSearchResults(query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);

    const q = query.toLowerCase().trim();
    this.currentQuery = q;
    // Matches live anywhere in the tree, so searching opens every folder and
    // leaving the query restores the tree underneath them.
    this.setSearchExpansion(q !== "");
    if (!q) {
      applyResults({
        container: this.innerTarget,
        q: "",
        filenameMatches: new Set(),
        contentMatches: new Map(),
        currentQuery: "",
        actions: this.actions!,
      });
      return;
    }

    const items = this.innerTarget.querySelectorAll<HTMLElement>(".nav-item");
    const filenameMatches = new Set<string>();
    for (const item of items) {
      const path = item.getAttribute("data-nav-path") || "";
      const label =
        item.querySelector(".nav-link")?.textContent?.toLowerCase() || "";
      if (label.includes(q)) filenameMatches.add(path);
    }
    applyResults({
      container: this.innerTarget,
      q,
      filenameMatches,
      contentMatches: new Map(),
      currentQuery: q,
      actions: this.actions!,
    });

    this.searchTimer = setTimeout(async () => {
      const matches = await searchContent(this.allPaths, q);
      const contentMatches = new Map<string, string[]>();
      for (const m of matches) {
        contentMatches.set(m.path, m.snippets);
      }
      applyResults({
        container: this.innerTarget,
        q,
        filenameMatches,
        contentMatches,
        currentQuery: q,
        actions: this.actions!,
      });
    }, 200);
  }

  /** Opens (or restores) every folder so search matches are never hidden. */
  private setSearchExpansion(searching: boolean): void {
    for (const section of this.innerTarget.querySelectorAll<HTMLElement>(
      ".nav-section",
    )) {
      const dirPath = section.getAttribute("data-nav-path") ?? "";
      if (!dirPath) continue;
      this.setSectionCollapsed(
        dirPath,
        searching
          ? false
          : this.collapsedSections.get(dirPath) ??
            !this.revealPaths.has(dirPath),
      );
    }
  }

  // --- Dirty reactivity ---

  /**
   * The "+ New" row doubles as a pending-changes nagger: the explorer is the
   * screen that shows which files changed, so Review (pending-changes screen)
   * and Save (flush everything) sit right under it instead of being buried in
   * the menu. Only shown while something is actually pending.
   */
  private updatePendingRow(count: number): void {
    if (!this.targets.has("pendingRow")) return
    this.pendingRowTarget.hidden = count === 0
    this.pendingCountTarget.textContent =
      count === 1 ? "1 change" : `${count} changes`
  }

  onReviewChanges(): void {
    appEvents.emit(AppEvent.DirtyClicked);
  }

  onFlushAll(): void {
    appEvents.emit(AppEvent.FlushAll);
  }

  private updateDirtyIndicators(dirtyPaths: string[]): void {
    const dirtySet = new Set(dirtyPaths);
    // Only update items whose dirty state changed
    for (const path of this.prevDirty) {
      if (!dirtySet.has(path)) this.setDirty(path, false);
    }
    for (const path of dirtySet) {
      if (!this.prevDirty.has(path)) this.setDirty(path, true);
    }
    this.prevDirty = dirtySet;
  }

  private setDirty(path: string, dirty: boolean): void {
    const item = this.itemByPath.get(path);
    if (!item) return;
    item.classList.toggle("pending-unsaved", dirty);
    const link = item.querySelector<HTMLElement>(".nav-link");
    if (link) link.classList.toggle("pending-unsaved", dirty);
    const badge = item.querySelector(".pending-badge.pending-badge-unsaved");
    if (dirty && !badge) {
      const span = document.createElement("span");
      span.className = "pending-badge pending-badge-unsaved";
      span.textContent = "unsaved";
      link?.appendChild(span);
    } else if (!dirty && badge) {
      badge.remove();
    }
  }

  setActive(path: string): void {
    this.innerTarget
      .querySelectorAll<HTMLElement>(".nav-link")
      .forEach((el) => el.classList.remove("active", "dir-active"));

    const dirIndex = path.replace(/\/_index(?:\.md)?$/, "");
    if (dirIndex !== path) {
      const section = this.innerTarget.querySelector<HTMLElement>(
        `.nav-section[data-nav-path="${CSS.escape(dirIndex)}"]`
      );
      const link = section?.querySelector<HTMLElement>(
        ".nav-section-title .nav-link"
      );
      if (link) {
        link.classList.add("active", "dir-active");
        return;
      }
    }

    const item = this.itemByPath.get(path);
    if (item) {
      const link = item.querySelector<HTMLElement>(".nav-link");
      if (link) link.classList.add("active");
    }
  }

  // --- Drag and drop ---

  private get canReorder(): boolean {
    if (!this.dragFromPath) return false;
    // Root home page is pinned first — reordering it is a no-op.
    if (this.dragFromPath === HOME_PATH) return false;
    // Folders without an `_index` page have no weight to write.
    if (this.dragFromIsDir) {
      return this.tree?.paths.has(`${this.dragFromPath}/${HOME_PATH}`) ?? false;
    }
    return true;
  }

  private parentPathOf(el: Element): string {
    const container = el.parentElement;
    if (!container || container === this.innerTarget) return "";
    return (
      container.closest<HTMLElement>(".nav-section")?.getAttribute("data-nav-path") ??
      ""
    );
  }

  private resetDragState(): void {
    this.dragFromPath = "";
    this.dragFromParent = "";
    this.dragFromIsDir = false;
    this.dragContainer = null;
    this.clearReorderIndicator();
    this.innerTarget
      .querySelectorAll(".drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
  }

  private clearReorderIndicator(): void {
    this.reorderBelow = "";
    this.reorderAbove = "";
    this.reorderIndicator?.remove();
    this.reorderIndicator = null;
  }

  onDragStart(e: DragEvent) {
    const target = e.target as HTMLElement;
    const navItem = target.closest(".nav-item");
    const navSection = target.closest(".nav-section");

    this.resetDragState();
    if (navItem) {
      const pagePath = navItem.getAttribute("data-nav-path");
      e.dataTransfer?.setData("text/plain", "file:" + pagePath);
      this.dragFromPath = pagePath || "";
      this.dragFromParent = this.parentPathOf(navItem);
      this.dragFromIsDir = false;
      this.dragContainer = navItem.parentElement as HTMLElement;
    } else if (navSection && !navItem) {
      const path = navSection.getAttribute("data-nav-path");
      e.dataTransfer?.setData("text/plain", "dir:" + path);
      this.dragFromPath = path || "";
      this.dragFromParent = this.parentPathOf(navSection);
      this.dragFromIsDir = true;
      this.dragContainer = navSection.parentElement as HTMLElement;
    }
  }

  onDragEnter(e: DragEvent) {
    const target = e.target as HTMLElement;
    const navSection = target.closest(".nav-section");
    if (navSection) {
      e.stopPropagation();
      e.preventDefault();
      if (navSection.getAttribute("data-nav-path") !== this.dragFromParent) {
        navSection.classList.add("drag-over");
        this.clearReorderIndicator();
      }
    }
  }

  onDragLeave(e: DragEvent) {
    const target = e.target as HTMLElement;
    const navSection = target.closest(".nav-section");
    if (navSection) {
      e.stopPropagation();
      const rt = e.relatedTarget;
      if (rt !== null && !navSection.contains(rt as Node)) {
        navSection.classList.remove("drag-over");
      }
    }
  }

  onDragOver(e: DragEvent) {
    const target = e.target as HTMLElement;
    if (!this.dragFromPath) return;

    const itemEl = target.closest(".nav-item");
    const sectionEl = target.closest(".nav-section");
    const sectionPath = sectionEl?.getAttribute("data-nav-path") ?? "";

    // Hovering a folder that is NOT the source's own parent → move-into-folder.
    if (sectionEl && sectionPath !== this.dragFromParent) {
      e.stopPropagation();
      e.preventDefault();
      sectionEl.classList.add("drag-over");
      this.clearReorderIndicator();
      return;
    }

    // Reorder zone: an item within the source's own sibling container, empty
    // space of that container, or root empty space.
    const itemInOwnParent =
      itemEl != null && itemEl.parentElement === this.dragContainer;
    const spaceInOwnParent =
      itemEl == null &&
      (sectionPath === this.dragFromParent ||
        (!sectionEl && this.dragFromParent === ""));
    if (!itemInOwnParent && !spaceInOwnParent) return;
    if (!this.canReorder) return;

    e.stopPropagation();
    e.preventDefault();
    this.updateReorderIndicator(e.clientY);
  }

  private updateReorderIndicator(clientY: number): void {
    if (!this.dragContainer) return;
    const siblings = Array.from(
      this.dragContainer.querySelectorAll<HTMLElement>(
        ":scope > .nav-item, :scope > .nav-section"
      )
    ).filter(
      (el) => (el.getAttribute("data-nav-path") || "") !== this.dragFromPath
    );

    if (siblings.length === 0) {
      this.clearReorderIndicator();
      return;
    }

    let belowEl: HTMLElement | null = null;
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        belowEl = s;
        break;
      }
    }

    const containerRect = this.dragContainer.getBoundingClientRect();
    let top = 0;
    if (belowEl) {
      const r = belowEl.getBoundingClientRect();
      top = r.top - containerRect.top;
      const idx = siblings.indexOf(belowEl);
      this.reorderAbove =
        idx > 0 ? siblings[idx - 1].getAttribute("data-nav-path") || "" : "";
      this.reorderBelow = belowEl.getAttribute("data-nav-path") || "";
    } else {
      const last = siblings[siblings.length - 1];
      const r = last.getBoundingClientRect();
      top = r.bottom - containerRect.top;
      this.reorderAbove = last.getAttribute("data-nav-path") || "";
      this.reorderBelow = "";
    }

    if (!this.reorderIndicator) {
      this.reorderIndicator = document.createElement("div");
      this.reorderIndicator.className = "drop-reorder-indicator";
      this.dragContainer.appendChild(this.reorderIndicator);
    }
    this.reorderIndicator.style.top = `${top}px`;
    this.reorderIndicator.style.display = "block";
  }

  onDragEnd() {
    this.resetDragState();
  }

  async onDrop(e: DragEvent) {
    const target = e.target as HTMLElement;
    e.stopPropagation();
    e.preventDefault();

    // Sibling reorder within the source's own parent.
    if (this.dragFromPath && (this.reorderBelow || this.reorderAbove)) {
      const fromPath = this.dragFromPath;
      const parentPath = this.dragFromParent;
      const abovePath = this.reorderAbove;
      const belowPath = this.reorderBelow;
      this.resetDragState();

      const children = this.tree?.children.get(parentPath) ?? [];
      const self = children.find((c) => c.path === fromPath);
      if (!self) return;
      const above = abovePath
        ? children.find((c) => c.path === abovePath)
        : undefined;
      const below = belowPath
        ? children.find((c) => c.path === belowPath)
        : undefined;

      // 1) Atomic revert — dragging a sibling back into the slot it vacated
      //    when `below` was previously reordered here cancels `below`'s pending
      //    op (single-op undo) instead of piling on a second weight.
      const revert = this.findAtomicRevert(parentPath, self, above, below);
      if (revert) {
        this.actions?.onReorderWeights([{ path: revert.path, weight: revert.weight }]);
        return;
      }

      // 2) Plain insert — there is integer room between the neighbors.
      const weight = this.computeReorderWeight(parentPath, fromPath, above, below);
      if (weight != null) {
        this.actions?.onReorderWeights([{ path: this.weightPathOf(self), weight }]);
        return;
      }

      // 3) Tight-slot exchange — adjacent weights, so the dragged item swaps
      //    into `below`'s slot and `below` bumps down by WEIGHT_EXCHANGE_SHIFT.
      const exchanged = this.trySlotExchange(parentPath, self, above, below);
      if (exchanged && exchanged.length > 0) {
        this.actions?.onReorderWeights(exchanged);
        return;
      }

      // 4) Packed siblings (no integer room) — re-normalize the contiguous run
      //    so the drop actually takes effect with distinct weights.
      const renormalized = this.computeRenormalize(parentPath, self, above, below);
      if (renormalized && renormalized.length > 0) {
        this.actions?.onReorderWeights(renormalized);
      }
      return;
    }

    this.resetDragState();

    const navSection = target.closest(".nav-section");
    if (!navSection) return;
    navSection.classList.remove("drag-over");

    const from = e.dataTransfer?.getData("text/plain");
    const to = navSection.getAttribute("data-nav-path") || "";

    if (from) {
      const fromIsDir = from.startsWith("dir:");
      const fromPath = from
        .replace(/^(?:dir|file):/, "")
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\//, "");
      const destPath = to + "/" + fromPath.split("/").pop();
      if (fromPath === destPath) return;
      if (fromIsDir && (to === fromPath || to.startsWith(fromPath + "/"))) {
        if (to.startsWith(fromPath + "/")) {
          showNotification(
            "Cannot move a folder into itself or its own child.",
            { title: "Sorry, not possible", type: "warning" }
          );
        }
        return;
      }
      // Check if destination exists using flat TreeIndex
      const exists = this.tree?.paths.has(destPath) ?? false;
      if (exists) {
        const confirmed = await confirmDialog({
          title: "Replace file?",
          message: `"${destPath}" already exists. Do you want to replace it?`,
          confirmLabel: "Replace",
        });
        if (!confirmed) return;
      }
      this.actions?.onMove(fromPath, destPath);
    }
  }

  /** File that carries the weight — a folder reorders via its `_index` page. */
  private weightPathOf(c: { path: string; isDir: boolean }): string {
    return c.isDir ? `${c.path}/${HOME_PATH}` : c.path;
  }

  /**
   * Atomic revert: when `below` has a pending weight op and `self` is being
   * dragged back into the slot it left behind, cancelling `below`'s op restores
   * the original order exactly. Returns the op to emit (setPageWeights turns a
   * `weight === original` request into op removal).
   */
  private findAtomicRevert(
    parentPath: string,
    self: { path: string; weight: number },
    above?: { path: string; weight: number },
    below?: { path: string; isDir: boolean; weight: number }
  ): { path: string; weight: number } | null {
    if (!above || !below) return null;
    const rawBelow = this.rawTree?.children
      .get(parentPath)
      ?.find((c) => c.path === below.path);
    if (!rawBelow) return null;
    const rawW = rawBelow.weight;
    // `below` must have a pending weight op (merged weight differs from disk).
    if (rawW === below.weight) return null;
    // Reverting `below` must place `self` directly above it.
    if (!(above.weight < self.weight && self.weight < rawW)) return null;
    // No other sibling may sit between `self` and `below`'s reverted position.
    const between = (this.tree?.children.get(parentPath) ?? []).some(
      (c) =>
        c.path !== self.path &&
        c.path !== below.path &&
        c.weight > self.weight &&
        c.weight < rawW
    );
    if (between) return null;
    return { path: this.weightPathOf(below), weight: rawW };
  }

  private computeReorderWeight(
    parentPath: string,
    fromPath: string,
    above?: ChildInfo,
    below?: ChildInfo
  ): number | null {
    const tree = this.tree;
    if (!tree) return null;
    const children = tree.children.get(parentPath) ?? [];
    const self = children.find((c) => c.path === fromPath);
    if (!self) return null;

    let weight: number;
    if (below && above) {
      const gap = below.weight - above.weight;
      if (gap <= 1) {
        // No integer room between packed siblings → slot exchange / re-normalization.
        return null;
      }
      // Prefer round steps (10, then 5, then 1), centered on the slot, capped at
      // WEIGHT_STEP so huge gaps don't balloon the weight values.
      const offset = Math.min(Math.floor(gap / 2), WEIGHT_STEP);
      let candidate = 0;
      for (const step of [10, 5, 1]) {
        candidate = Math.floor(offset / step) * step;
        if (candidate >= 1) break;
      }
      weight = above.weight + candidate;
    } else if (below) {
      // Dropped at the top of the list — anchor at 0 (Hugo: lower weight = first).
      weight = below.weight === 0 ? below.weight - 1 : 0;
    } else if (above) {
      weight = above.weight + WEIGHT_STEP;
    } else {
      return null;
    }

    return weight === self.weight ? null : weight;
  }

  /**
   * Tight-slot exchange: neighbors are adjacent (gap of exactly 1), so nothing
   * can be inserted between them. The dragged item takes `below`'s weight and
   * `below` shifts down by WEIGHT_EXCHANGE_SHIFT, keeping the order while
   * preserving distinct weights. Returns null when the shift would collide with
   * the next sibling, when weights tie, or when the dragged item already sits at
   * the target weight (revert / re-normalize handles those).
   */
  private trySlotExchange(
    parentPath: string,
    self: ChildInfo,
    above?: ChildInfo,
    below?: ChildInfo
  ): { path: string; weight: number }[] | null {
    if (!above || !below) return null;
    const gap = below.weight - above.weight;
    if (gap !== 1) return null;
    if (below.weight === self.weight) return null;
    const shifted = below.weight + WEIGHT_EXCHANGE_SHIFT;
    const collide = (this.tree?.children.get(parentPath) ?? []).some(
      (c) =>
        c.path !== below.path &&
        c.path !== self.path &&
        c.weight > below.weight &&
        c.weight <= shifted
    );
    if (collide) return null;
    return [
      { path: this.weightPathOf(self), weight: below.weight },
      { path: this.weightPathOf(below), weight: shifted },
    ];
  }

  /**
   * Packed siblings (weights are consecutive integers, so no insert point
   * exists): re-number the contiguous run around the slot so the dragged item
   * lands exactly where dropped and the displaced siblings shift by one.
   * Returns one weight op per sibling whose weight changes.
   */
  private computeRenormalize(
    parentPath: string,
    self: ChildInfo,
    above?: ChildInfo,
    below?: ChildInfo
  ): { path: string; weight: number }[] | null {
    if (!above || !below) return null;
    const children = (this.tree?.children.get(parentPath) ?? [])
      .slice()
      .sort(
        (a, b) => a.weight - b.weight || a.name.localeCompare(b.name)
      );
    const lo = Math.min(above.weight, below.weight);
    const hi = Math.max(above.weight, below.weight);
    if (hi - lo > 1) return null;

    // Maximal contiguous integer run containing the insertion slot.
    let min = lo;
    let max = hi;
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of children) {
        if (c.weight === min - 1) {
          min = c.weight;
          changed = true;
        } else if (c.weight === max + 1) {
          max = c.weight;
          changed = true;
        }
      }
    }

    const block = children.filter((c) => c.weight >= min && c.weight <= max);
    // Final order: the block in current order, with `self` inserted right after `above`.
    const finalOrder: ChildInfo[] = [];
    let inserted = false;
    for (const c of block) {
      if (c.path === self.path) continue;
      finalOrder.push(c);
      if (c.path === above.path && !inserted) {
        finalOrder.push(self);
        inserted = true;
      }
    }
    if (!inserted) {
      const idx = finalOrder.findIndex((c) => c.path === above.path);
      finalOrder.splice(idx + 1, 0, self);
    }

    const ops: { path: string; weight: number }[] = [];
    for (let i = 0; i < finalOrder.length; i++) {
      const w = min + i;
      const c = finalOrder[i];
      if (w !== c.weight) {
        ops.push({ path: this.weightPathOf(c), weight: w });
      }
    }
    return ops.length > 0 ? ops : null;
  }
}
