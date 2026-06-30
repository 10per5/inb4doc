import { Controller } from "@hotwired/stimulus";
import { mountPrefsDialog } from "../components/dialogs/prefs-dialog";
import type { TopbarAPI } from "../components/toolbar/topbar";
import type { MetaPanelAPI } from "../components/panels/meta-panel";
import { ToolbarService } from "../services/toolbar-service";
import { UIInitializerService } from "../services/ui-initializer-service";
import { UIService } from "../services/ui-service";
import { EditorService } from "../services/editor-service";
import { CacheManagementService } from "../services/cache-management-service";
import { ViewManagementService } from "../services/view-management-service";
import { NavigationService } from "../services/navigation-service";
import { getProvider, getProviderDisplayInfo } from "../content/provider-registry";
import { cache } from "../cache";
import type { TreeNode } from "../content/provider";
import { exportToZip, pickAndParseZip } from "../utils/zip";
import type { ZipEntry, ZipFileEntry } from "../utils/zip";
import { mountImportZipDialog } from "../components/dialogs/import-zip-dialog";
import { mountImageManagerDialog } from "../components/dialogs/image-manager-dialog";
import { showToast } from "../components/toast/toast";
import { loadPrefs } from "../storage";
import { PathService } from "../services/path-service";
import { imageRegistry } from "../services/image-registry";

function flattenTree(node: TreeNode, prefix = ""): string[] {
  const paths: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (value === null || (typeof value === "object" && "weight" in value)) {
      paths.push(prefix + key.replace(/\.md$/, ""))
    } else if (typeof value === "object") {
      paths.push(...flattenTree(value as TreeNode, prefix + key + "/"))
    }
  }
  return paths
}

let sessionStarted = 0;

export function setSessionStarted(time: number) {
  sessionStarted = time;
}

export default class extends Controller {
  private toolbarService!: ToolbarService;
  private uiInitializer!: UIInitializerService;
  private uiService!: UIService;
  private editorService!: EditorService;
  private cacheService!: CacheManagementService;
  private viewService!: ViewManagementService;
  private navService!: NavigationService;
  private topbar!: TopbarAPI;
  private metaPanel!: MetaPanelAPI;
  private onBeforeUnload: (() => void) | null = null;

  async connect() {
    const initialPath = this.data.get("path")
      || new PathService().getInitialPath();

    this.uiService = UIService.getInstance();
    this.uiInitializer = new UIInitializerService();

    // Restore pending images from IndexedDB (recreates blob URLs)
    try { await imageRegistry.restoreFromStorage() } catch {}

    let syncTimer: ReturnType<typeof setTimeout> | null = null

    this.editorService = new EditorService({
      onContentChange: (content) => {
        cache.setBody(this.navService.getCurrentPath(), content);
        this.cacheService?.updateDirtyCounter();
        if (syncTimer) clearTimeout(syncTimer)
        syncTimer = setTimeout(() => cache.sync(), 500)
      },
      onDirtyChange: () => this.cacheService?.updateDirtyCounter(),
    });
    this.editorService.setCurrentPath(initialPath);

    this.cacheService = new CacheManagementService({
      getCurrentContent: () => this.editorService.getCurrentContent(),
      onDirtyCountChanged: (count, bytes, pendingCount) => {
        this.topbar?.hideSingleDiscard();
        this.topbar?.updateCounter(count, bytes, pendingCount);
        this.topbar?.setDirtyState(count > 0 || (pendingCount ?? 0) > 0);
      },
      onSingleCurrentDirty: (path, bytes) => {
        this.topbar?.showSingleDiscard(path, bytes);
        this.topbar?.setDirtyState(true);
      },
      onFlushComplete: () => this.loadSidebar(),
      onSidebarReload: () => this.loadSidebar(),
      onNavigate: (path) => this.navService?.navigate(path),
      onContentReload: (path, body) => this.editorService.ensureEditor(body),
    });
    this.cacheService.setCurrentPath(initialPath);

    // Sync to localStorage before page unload
    this.onBeforeUnload = () => { cache.sync() }
    window.addEventListener("beforeunload", this.onBeforeUnload)

    this.toolbarService = new ToolbarService({ stickyToolbar: loadPrefs().stickyToolbar });
    this.toolbarService.initialize();

    this.viewService = new ViewManagementService(
      {
        onSourceMode: () => this.editorService.isSourceMode(),
        onViewChanged: (view) => this.topbar?.setView(view),
      },
      sessionStarted
    );

    this.navService = new NavigationService({
      onBeforeNavigate: (path) => {
        this.viewService?.getViewManager().switchTo("editor");
        this.editorService.setCurrentPath(path);
        this.cacheService.setCurrentPath(path);
      },
      onContentNeeded: (path) => this.editorService.fetchContent(path, (data) => this.metaPanel?.update(data)),
      onContentReady: (path, content) => this.editorService.ensureEditor(content),
      onNavigate: () => {},
      onSearchNavigate: (query, matchIndex, snippetText) => {
        this.editorService?.scrollToText(query, matchIndex, snippetText);
      },
      onSidebarReload: async () => {
        await this.loadSidebar();
      },
      onProviderChanged: (type) => {
        const pdi = getProviderDisplayInfo(type);
        this.topbar?.setProviderBadge(pdi.icon, pdi.label);
        this.topbar?.setProviderType(type);
      },
      onUpdateUI: () => this.cacheService?.updateDirtyCounter(),
    });
    this.navService.setCacheService(this.cacheService);
    this.navService.setCurrentPath(initialPath);

    this.viewService.initialize();

    this.topbar = this.uiInitializer.initializeTopbar(
      () => this.editorService.getEditor(),
      {
        onPrefs: () => {
          mountPrefsDialog({
            onStickyToolbarChange: (sticky) => {
              this.toolbarService.setStickyPreference(sticky);
            },
          });
        },
        onDirtyClick: () => this.cacheService.handleDirtyClick(),
        onSingleDiscard: (path) => this.cacheService.discardFileChanges(path),
        onChangeProvider: () => this.navService.changeProvider(),
        onViewChange: (view) => this.viewService.getViewManager().switchTo(view),
        onSave: () => exportToZip().then(() => this.loadSidebar()),
        onLoad: async () => {
          const rawEntries = await pickAndParseZip();
          if (!rawEntries) return;

          const provider = getProvider();
          const tree = await provider.getTree();
          const existing = new Set(flattenTree(tree));

          const entries: ZipFileEntry[] = rawEntries.map((e: ZipEntry) => ({
            ...e,
            exists: existing.has(e.relPath.replace(/\.md$/, "")),
          }));

          mountImportZipDialog(
            entries,
            async (result) => {
              if (result.selected.length === 0) return;
              const paths = result.selected.map((e: ZipFileEntry) => e.relPath.replace(/\.md$/, ""));
              await Promise.all(paths.map((path: string) => {
                const entry = rawEntries.find((r: ZipEntry) => r.relPath.replace(/\.md$/, "") === path);
                return entry ? provider.writeFile(path, entry.content) : Promise.resolve();
              }));
              cache.clearAll();
              cache.sync();
              await this.loadSidebar();
              await this.editorService.loadContent(initialPath, (data) => this.metaPanel?.update(data));
              showToast(`Imported ${result.selected.length} file${result.selected.length > 1 ? "s" : ""}`);
            },
            () => {},
          );
        },
        onImageManager: () => mountImageManagerDialog(),
        onToggleSidebar: () => this.uiService.toggleSidebar(),
        onToggleMetaPanel: () => this.uiService.toggleMetaPanel(),
      }
    )!;

    const providerInfo = getProviderDisplayInfo(getProvider().name);
    this.topbar?.setProviderBadge(providerInfo.icon, providerInfo.label);
    this.topbar?.setProviderType(getProvider().name);

    this.metaPanel = this.uiInitializer.initializeMetaPanel((data) => {
      const path = this.navService.getCurrentPath();
      cache.setFrontmatter(path, data);
      cache.addDirty(path);
      cache.sync();
      this.cacheService?.updateDirtyCounter();
    })!;

    await this.editorService.loadContent(initialPath, (data) => this.metaPanel?.update(data));
    await this.loadSidebar();
    this.cacheService.updateDirtyCounter();
  }

  disconnect() {
    if (this.onBeforeUnload) window.removeEventListener("beforeunload", this.onBeforeUnload)
    this.toolbarService?.destroy();
    this.uiService?.destroy();
    this.editorService?.destroy();
  }

  private loadSidebar(): Promise<void> {
    return this.navService.loadSidebar(
      (p, query, matchIndex, snippetText) => this.navService.navigate(p, true, query, matchIndex, snippetText),
      (pages, meta) => this.editorService.getMentionView()?.setPages(pages, meta),
    );
  }

  toggleSource = () => this.editorService.toggleSourceMode();
  applySource = () => this.editorService.applySourceContent();
  flush = () => this.cacheService.flushDirtyFiles();
}
