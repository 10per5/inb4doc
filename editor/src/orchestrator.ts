import { mountPrefsDialog } from "@/components/dialogs/prefs-dialog";
import type { TopbarAPI } from "@/components/toolbar/topbar";
import type { MetaPanelAPI } from "@/components/panels/meta-panel";
import { ToolbarService } from "@/services/toolbar-service";
import { UIInitializerService } from "@/services/ui-initializer-service";
import { UIService } from "@/stores/ui-store";
import { EditorService } from "@/services/editor-service";
import { CacheManagementService } from "@/services/cache-management-service";
import { ViewManagementService } from "@/services/view-management-service";
import { NavigationService } from "@/services/navigation-service";
import { getProvider, getProviderDisplayInfo } from "@/providers/provider-registry";
import { cache } from "@/stores/cache";
import type { TreeNode } from "@/providers/provider";
import { exportToZip, pickAndParseZip } from "@/utils/zip";
import type { ZipEntry, ZipFileEntry } from "@/utils/zip";
import { mountImportZipDialog } from "@/components/dialogs/import-zip-dialog";
import { mountImageManagerDialog } from "@/components/dialogs/image-manager-dialog";
import { showNotification } from "@/components/notification/notification";
import { loadPrefs } from "@/utils/storage";
import { applyThemeFromPrefs } from "@/components/dialogs/prefs-dialog";
import { getCurrentPath } from "@/utils/url";
import { imageRegistry } from "@/stores/image-registry";
import { hotkeys } from "@/services/hotkey-manager";
import { setEditorService } from "@/bridge/index";

let sessionStarted = 0;

export function setSessionStarted(time: number) {
  sessionStarted = time;
}

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

export class AppOrchestrator {
  editor: EditorService
  cache: CacheManagementService
  nav: NavigationService
  view: ViewManagementService
  topbar?: TopbarAPI

  private initialPath: string
  private uiInitializer: UIInitializerService
  private uiService: UIService
  private toolbarService?: ToolbarService
  private metaPanel?: MetaPanelAPI
  private onBeforeUnload: (() => void) | null = null

  constructor(opts: { initialPath: string }) {
    this.initialPath = opts.initialPath
    this.uiService = UIService.getInstance()
    this.uiInitializer = new UIInitializerService()

    applyThemeFromPrefs()

    this.editor = new EditorService({
      onContentChange: (content) => {
        cache.setBody(this.nav.getCurrentPath(), content)
        this.cache?.updateDirtyCounter()
      },
      onDirtyChange: () => this.cache?.updateDirtyCounter(),
    })
    this.editor.setCurrentPath(this.initialPath)
    setEditorService(this.editor)

    this.cache = new CacheManagementService({
      getCurrentContent: () => this.editor.getCurrentContent(),
      onDirtyCountChanged: (count, bytes, pendingCount) => {
        this.topbar?.hideSingleDiscard()
        this.topbar?.updateCounter(count, bytes, pendingCount)
        this.topbar?.setDirtyState(count > 0 || (pendingCount ?? 0) > 0)
      },
      onSingleCurrentDirty: (path, bytes) => {
        this.topbar?.showSingleDiscard(path, bytes)
        this.topbar?.setDirtyState(true)
      },
      onFlushComplete: () => this.loadSidebar(),
      onSidebarReload: () => this.loadSidebar(),
      onNavigate: (path) => this.nav?.navigate(path),
      onContentReload: (path, body) => this.editor.ensureEditor(body),
    })
    this.cache.setCurrentPath(this.initialPath)

    this.view = new ViewManagementService(
      {
        onSourceMode: () => this.editor.isSourceMode(),
        onViewChanged: (view) => this.topbar?.setView(view),
      },
      sessionStarted
    )

    this.nav = new NavigationService({
      onBeforeNavigate: (path) => {
        this.view.getViewManager().switchTo("editor")
        this.editor.setCurrentPath(path)
        this.cache.setCurrentPath(path)
      },
      onContentNeeded: async (path) => {
        const ops = this.cache.getPendingOps()
        const moveOp = ops.find(o => o.type === "move" && o.to === path) as
          | { type: "move"; from: string; to: string }
          | undefined
        const effectivePath = moveOp ? moveOp.from : path
        return this.editor.fetchContent(effectivePath, (data) => this.metaPanel?.update(data))
      },
      onContentReady: (path, content) => this.editor.ensureEditor(content),
      onNavigate: () => {},
      onSearchNavigate: (query, matchIndex, snippetText) => {
        this.editor?.scrollToText(query, matchIndex, snippetText)
      },
      onSidebarReload: async () => {
        await this.loadSidebar()
      },
      onProviderChanged: (type) => {
        const pdi = getProviderDisplayInfo(type)
        this.topbar?.setProviderBadge(pdi.icon, pdi.label)
        this.topbar?.setProviderType(type)
      },
      onUpdateUI: () => this.cache?.updateDirtyCounter(),
    })
    this.nav.setCacheService(this.cache)
    this.nav.setCurrentPath(this.initialPath)
  }

  async initialize() {
    try { await imageRegistry.restoreFromStorage() } catch {}

    this.toolbarService = new ToolbarService({ stickyToolbar: loadPrefs().stickyToolbar })
    this.toolbarService.initialize()

    this.view.initialize()

    this.topbar = this.uiInitializer.initializeTopbar(
      () => this.editor.getEditor(),
      {
        onPrefs: () => {
          mountPrefsDialog({
            onStickyToolbarChange: (sticky) => {
              this.toolbarService!.setStickyPreference(sticky)
            },
          })
        },
        onDirtyClick: () => this.cache.handleDirtyClick(),
        onSingleDiscard: (path) => this.cache.discardFileChanges(path),
        onChangeProvider: () => this.nav.changeProvider(),
        onViewChange: (view) => this.view.getViewManager().switchTo(view),
        onSave: () => exportToZip().then(() => this.loadSidebar()),
        onLoad: async () => {
          const rawEntries = await pickAndParseZip()
          if (!rawEntries) return

          const provider = getProvider()
          const tree = await provider.getTree()
          const existing = new Set(flattenTree(tree))

          const entries: ZipFileEntry[] = rawEntries.map((e: ZipEntry) => ({
            ...e,
            exists: existing.has(e.relPath.replace(/\.md$/, "")),
          }))

          mountImportZipDialog(
            entries,
            async (result) => {
              if (result.selected.length === 0) return
              const paths = result.selected.map((e: ZipFileEntry) => e.relPath.replace(/\.md$/, ""))
              await Promise.all(paths.map((path: string) => {
                const entry = rawEntries.find((r: ZipEntry) => r.relPath.replace(/\.md$/, "") === path)
                return entry ? provider.writeFile(path, entry.content) : Promise.resolve()
              }))
              cache.clearAll()
              cache.sync()
              await this.loadSidebar()
              await this.editor.loadContent(this.initialPath, (data) => this.metaPanel?.update(data))
              showNotification(`Imported ${result.selected.length} file${result.selected.length > 1 ? "s" : ""}`, { type: "info" })
            },
            () => {},
          )
        },
        onImageManager: () => mountImageManagerDialog(),
        onToggleSidebar: () => this.uiService.toggleSidebar(),
        onToggleMetaPanel: () => this.uiService.toggleMetaPanel(),
      }
    )!

    const providerInfo = getProviderDisplayInfo(getProvider().name)
    this.topbar?.setProviderBadge(providerInfo.icon, providerInfo.label)
    this.topbar?.setProviderType(getProvider().name)

    this.metaPanel = this.uiInitializer.initializeMetaPanel((data) => {
      const path = this.nav.getCurrentPath()
      cache.setFrontmatter(path, data)
      cache.addDirty(path)
      cache.sync()
      this.cache?.updateDirtyCounter()
    })!

    // Fix up stale blob: URLs in cached content with pending-image:{id} references
    await this.cache.afterRestore()
    await this.editor.loadContent(this.initialPath, (data) => this.metaPanel?.update(data))
    await this.loadSidebar()
    this.cache.updateDirtyCounter()

    this.onBeforeUnload = () => { cache.sync() }
    window.addEventListener("beforeunload", this.onBeforeUnload)

    hotkeys.register("ctrl+s", () => this.saveCurrentFile())
  }

  destroy() {
    if (this.onBeforeUnload) window.removeEventListener("beforeunload", this.onBeforeUnload)
    this.toolbarService?.destroy()
    this.uiService?.destroy()
    this.editor?.destroy()
  }

  private async loadSidebar(): Promise<void> {
    return this.nav.loadSidebar(
      (p, query, matchIndex, snippetText) => this.nav.navigate(p, true, query, matchIndex, snippetText),
      (pages, meta) => this.editor.getMentionView()?.setPages(pages, meta),
    )
  }

  toggleSource = () => this.editor.toggleSourceMode()
  applySource = () => this.editor.applySourceContent()
  flush = () => this.cache.flushDirtyFiles()

  private async saveCurrentFile(): Promise<void> {
    const path = this.nav.getCurrentPath()
    const dirtyPaths = cache.getDirtyPaths()
    if (!dirtyPaths.includes(path)) {
      showNotification("No changes to save", { type: "info" })
      return
    }
    const content = this.editor.getCurrentContent()
    await this.cache.flushCurrentFile(path, content)
  }
}
