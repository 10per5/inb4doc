/**
 * AppController — composition root.
 *
 * Creates controllers, wires event subscriptions, and handles
 * application lifecycle. All UI communication flows through the
 * event bus: components emit user-intents, controllers subscribe.
 */

import { mountPrefsDialog, applyThemeFromPrefs } from "@/components/dialogs/prefs-dialog";
import { mountTopbar } from "@/components/toolbar/topbar";
import { mountMetaPanel } from "@/components/panels/meta-panel";
import { ToolbarStore } from "@/stores/toolbar-store";
import { UIService } from "@/stores/ui-store";
import { EditorController } from "@/controllers/editor-controller";
import { FileSyncController } from "@/controllers/file-sync-controller";
import { ViewController } from "@/controllers/view-controller";
import { NavigationController } from "@/controllers/navigation-controller";
import { getProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { NEW_PAGE_BODY } from "@/utils/constants"
import { pageRepository } from "@/repositories/pageRepository";
import type { TreeNode } from "@/providers/provider";
import { HOME_PATH, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import { Frontmatter } from "@/entities/Frontmatter";
import { exportToZip, pickAndParseZip } from "@/utils/zip";
import type { ZipEntry, ZipFileEntry } from "@/utils/zip";
import { mountImportZipDialog } from "@/components/dialogs/import-zip-dialog";
import { mountImageManagerDialog } from "@/components/dialogs/image-manager-dialog";
import { showNotification } from "@/components/notification/notification";
import { loadPrefs } from "@/utils/storage";
import { getCurrentPath, replacePath } from "@/utils/url";
import { imageRepository } from "@/repositories/imageRepository";
import * as hotkeys from "@/utils/hotkeys";
import { setEditorService } from "@/bridge/index";
import { appEvents, AppEvent } from "@/stores/app-events";
import { PendingOpType } from "@/entities/PendingOps";

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

export class AppController {
  editor: EditorController
  cache: FileSyncController
  nav: NavigationController
  view: ViewController

  private initialPath: string
  private uiService: UIService
  private toolbarStore?: ToolbarStore
  private onBeforeUnload: (() => void) | null = null
  private unsubs: (() => void)[] = []

  constructor(opts: { initialPath: string }) {
    this.initialPath = opts.initialPath
    this.uiService = UIService.getInstance()

    applyThemeFromPrefs()

    // Create controllers
    this.editor = new EditorController()
    this.cache = new FileSyncController(this.editor)
    this.view = new ViewController(this.editor, sessionStarted)
    this.nav = new NavigationController(this.editor, this.cache)

    // Wire dependencies
    this.editor.setCurrentPath(this.initialPath)
    this.cache.setCurrentPath(this.initialPath)
    this.nav.setCurrentPath(this.initialPath)

    // Set up bridge
    setEditorService(this.editor as any)

    // Subscribe to bus events
    this.unsubs.push(
      // ── Sidebar ──
      appEvents.on(AppEvent.FlushComplete, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.SidebarReload, () => this.nav.loadSidebar()),

      // ── User intents from topbar / file-menu ──
      appEvents.on(AppEvent.PrefsOpened, () => {
        mountPrefsDialog({
          onStickyToolbarChange: (sticky) => this.toolbarStore!.setStickyPreference(sticky),
        })
      }),
      appEvents.on(AppEvent.DirtyClicked, () => this.cache.handleDirtyClick()),
      appEvents.on(AppEvent.SingleDiscardRequested, ({ path }) => this.cache.discardFileChanges(path)),
      appEvents.on(AppEvent.SaveRequested, () => {
        exportToZip().then(() => this.nav.loadSidebar())
      }),
      appEvents.on(AppEvent.LoadRequested, () => this.handleLoadZip()),
      appEvents.on(AppEvent.ImageManagerOpened, () => mountImageManagerDialog()),
      appEvents.on(AppEvent.SidebarToggle, () => this.uiService.toggleSidebar()),
      appEvents.on(AppEvent.MetaPanelToggle, () => this.uiService.toggleMetaPanel()),
      appEvents.on(AppEvent.ProviderChangeRequested, () => this.nav.changeProvider()),

      // ── Save / Flush (unified API) ──
      appEvents.on(AppEvent.SaveCurrentFile, () => this.saveCurrentFile()),
      appEvents.on(AppEvent.FlushAll, () => this.cache.flushDirtyFiles()),

      // ── Empty project ──
      appEvents.on(AppEvent.ProjectEmpty, () => {
        this.view.switchTo("empty-project")
      }),
      appEvents.on(AppEvent.CreateFirstPage, () => {
        this.cache.createDraft(HOME_PATH, NEW_PAGE_BODY)
        this.view.switchTo("editor")
        appEvents.emit(AppEvent.Navigate, { path: HOME_PATH })
      }),

      // ── View switching ──
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.view.switchTo(view)
      }),

      // ── Meta panel changes ──
      appEvents.on(AppEvent.MetaDataChanged, ({ data }) => {
        const path = this.nav.getCurrentPath()
        pageRepository.getOrCreate(path).frontmatter = Frontmatter.fromMeta(data)
        pageRepository.getOrCreate(path).markDirty()
        pageRepository.save()
        this.cache.updateDirtyCounter()
      }),
    )
  }

  async initialize() {
    try { await imageRepository.restoreFromStorage() } catch {}

    this.toolbarStore = new ToolbarStore({ stickyToolbar: loadPrefs().stickyToolbar })
    this.toolbarStore.initialize()

    this.view.initialize()

    const { path: startPath, isNew } = await this.resolveInitialPath()
    this.initialPath = startPath
    this.editor.setCurrentPath(startPath)
    this.cache.setCurrentPath(startPath)
    this.nav.setCurrentPath(startPath)

    if (isNew) {
      appEvents.emit(AppEvent.ProjectEmpty)
    } else {
      replacePath(startPath)
    }

    // Mount topbar (no callbacks — uses bus)
    const toolbarEl = document.getElementById("app-toolbar")
    if (toolbarEl) {
      mountTopbar(toolbarEl, () => this.editor.getEditor())
    }

    // Emit initial provider info
    const providerInfo = getProviderDisplayInfo(getProvider().name)
    appEvents.emit(AppEvent.ProviderChanged, {
      type: getProvider().name,
      icon: providerInfo.icon,
      label: providerInfo.label,
    })

    // Mount meta panel (no callback — uses bus)
    const metaMount = document.getElementById("meta-panel-mount")
    if (metaMount) {
      const metaPanel = mountMetaPanel(metaMount)
      this.nav.setMetaPanel(metaPanel)
    }

    // Fix up stale blob: URLs
    await this.cache.afterRestore()
    await this.editor.loadContent(startPath, (data) => this.nav.getMetaPanel()?.update(data))
    await this.nav.loadSidebar()
    this.cache.updateDirtyCounter()

    this.onBeforeUnload = () => { pageRepository.save() }
    window.addEventListener("beforeunload", this.onBeforeUnload)

    hotkeys.register("ctrl+s", () => appEvents.emit(AppEvent.SaveCurrentFile))
    hotkeys.attach()
  }

  destroy() {
    if (this.onBeforeUnload) window.removeEventListener("beforeunload", this.onBeforeUnload)
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.toolbarStore?.destroy()
    this.uiService?.destroy()
    this.editor?.destroy()
    this.cache?.destroy()
    this.nav?.destroy()
    this.view?.destroy()
    hotkeys.detach()
  }

  toggleSource = () => this.editor.toggleSourceMode()
  applySource = () => this.editor.applySourceContent()
  flush = () => this.cache.flushDirtyFiles()

  private async saveCurrentFile(): Promise<void> {
    const path = this.nav.getCurrentPath()
    if (!path) return

    // Handle pending (new unflushed) files — flush the create operation
    const pendingCreate = this.cache.getPendingOps().all.find(
      (e) => e.type === PendingOpType.Create && e.path === path
    )
    if (pendingCreate) {
      await this.cache.flushDirtyFiles()
      return
    }

    // Handle pending delete on current file — flush the deletion
    const pendingDelete = this.cache.getPendingOps().all.find(
      (e) => e.type === PendingOpType.Delete && e.path === path
    )
    if (pendingDelete) {
      await this.cache.flushDirtyFiles()
      return
    }

    const dirtyPaths = pageRepository.getDirtyPaths()
    if (!dirtyPaths.includes(path)) {
      showNotification("No changes to save", { type: "info" })
      return
    }
    const content = this.editor.getCurrentContent()
    await this.cache.flushCurrentFile(path, content)
  }

  private async handleLoadZip(): Promise<void> {
    const rawEntries = await pickAndParseZip()
    if (!rawEntries) return

    const tree = treeStore.getTree()
    const provider = getProvider()
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
        pageRepository.clearAll()
        pageRepository.save()
        await this.nav.loadSidebar()
        await this.editor.loadContent(this.initialPath, (data) => this.nav.getMetaPanel()?.update(data))
        showNotification(`Imported ${result.selected.length} file${result.selected.length > 1 ? "s" : ""}`, { type: "info" })
      },
      () => {},
    )
  }

  private async resolveInitialPath(): Promise<{ path: string; isNew: boolean }> {
    const requested = this.initialPath || HOME_PATH
    const tree = treeStore.getTree()
    const pages = flattenTree(tree)

    if (pages.includes(requested)) {
      return { path: requested, isNew: false }
    }

    const preferred = resolveHomePageFromPaths(pages)
    if (preferred) {
      return { path: preferred, isNew: false }
    }

    return { path: requested, isNew: true }
  }
}
