/**
 * ShellController — Stimulus composition root (merged from AppController).
 *
 * Finds child Stimulus controllers (editor, sidebar, topbar) via targets/outlets,
 * creates plain-class sub-controllers (NavigationController, FileSyncController,
 * ViewController), and wires event subscriptions.
 */

import { Controller } from "@hotwired/stimulus"
import type { Editor } from "@milkdown/kit/core"
import { openPrefsDialog, applyThemeFromPrefs } from "@/components/dialogs/prefs-dialog";
import { mountMetaPanel } from "@/components/panels/meta-panel";
import { ToolbarStore } from "@/stores/toolbar-store";
import { UIService } from "@/stores/ui-store";
import { EditorController } from "@/controllers/editor-controller";
import { FileSyncController } from "@/controllers/file-sync-controller";
import { ViewController } from "@/controllers/view-controller";
import { NavigationController } from "@/controllers/navigation-controller";
import type SidebarController from "@/controllers/sidebar-controller";
import { getProvider, getProviderDisplayInfo } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { NEW_PAGE_BODY } from "@/utils/constants"
import { pageRepository } from "@/repositories/pageRepository";
import { HOME_PATH, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import { exportToZip, pickAndParseZip } from "@/utils/zip";
import type { ZipEntry, ZipFileEntry } from "@/utils/zip";
import { openImportZipDialog } from "@/components/dialogs/import-zip-dialog";
import { openImageManagerDialog } from "@/components/dialogs/image-manager-dialog";
import { showNotification } from "@/components/notification/notification";
import { loadPrefs } from "@/utils/storage";
import { getCurrentPath, replacePath } from "@/utils/url";
import { imageRepository } from "@/repositories/imageRepository";
import * as hotkeys from "@/utils/hotkeys";
import { setEditorService } from "@/bridge/index";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { flushSave } from "@/stores/persistence";
import { PendingOpType } from "@/entities/PendingOps";
import { hideLoadingOverlay } from "@/components/overlay/loading-overlay";

let sessionStarted = 0;

export function setSessionStarted(time: number) {
  sessionStarted = time;
}

function treePaths(tree: ReturnType<typeof treeStore.getTree>): string[] {
  return Array.from(tree.paths)
}

export default class extends Controller {
  static targets = ["sidebar", "editorArea", "metaPanel"]
  static outlets = ["editor"]

  declare readonly sidebarTarget: HTMLElement
  declare readonly editorAreaTarget: HTMLElement
  declare readonly metaPanelTarget: HTMLElement

  private editor!: EditorController
  private cache!: FileSyncController
  private nav!: NavigationController
  private view!: ViewController

  private initialPath: string = ""
  private uiService: UIService = UIService.getInstance()
  private toolbarStore?: ToolbarStore
  private onBeforeUnload: (() => void) | null = null
  private unsubs: (() => void)[] = []
  private appInitialized = false

  connect() {
    applyThemeFromPrefs()
    this.initialPath = this.data.get("path") || getCurrentPath()
  }

  editorOutletConnected(outlet: EditorController) {
    if (this.appInitialized) return
    this.appInitialized = true

    this.editor = outlet
    this.wireTopbar()
    this.initializeApp()
  }

  private wireTopbar() {
    const el = this.element.querySelector(".app-toolbar")
    if (!el) return
    const topbar = this.application.getControllerForElementAndIdentifier(el, "topbar") as
      | unknown as { setEditorGetter: (getter: () => Editor | null) => void }
      | undefined
    topbar?.setEditorGetter(() => this.editor.getEditor())
  }

  private async initializeApp() {
    this.cache = new FileSyncController(this.editor as any)
    this.view = new ViewController(this.editor as any, sessionStarted)
    const sidebarController = this.application.getControllerForElementAndIdentifier(
      this.sidebarTarget, "sidebar"
    ) as unknown as SidebarController
    this.nav = new NavigationController(this.editor as any, this.cache, this.sidebarTarget, sidebarController)

    this.editor.setCurrentPath(this.initialPath)
    this.cache.setCurrentPath(this.initialPath)
    this.nav.setCurrentPath(this.initialPath)

    dirtyTrackingService.setPathResolver(() => this.nav.getCurrentPath())
    dirtyTrackingService.start()

    setEditorService(this.editor as any)

    this.unsubs.push(
      appEvents.on(AppEvent.FlushComplete, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.SidebarReload, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.PrefsOpened, () => {
        openPrefsDialog({
          onStickyToolbarChange: (sticky) => this.toolbarStore!.setStickyPreference(sticky),
        })
      }),
      appEvents.on(AppEvent.DirtyClicked, () => this.cache.handleDirtyClick()),
      appEvents.on(AppEvent.SingleDiscardRequested, ({ path }) => this.cache.discardFileChanges(path)),
      appEvents.on(AppEvent.SaveRequested, () => {
        exportToZip().then(() => this.nav.loadSidebar())
      }),
      appEvents.on(AppEvent.LoadRequested, () => this.handleLoadZip()),
      appEvents.on(AppEvent.ImageManagerOpened, () => openImageManagerDialog()),
      appEvents.on(AppEvent.SidebarToggle, () => this.uiService.toggleSidebar()),
      appEvents.on(AppEvent.MetaPanelToggle, () => this.uiService.toggleMetaPanel()),
      appEvents.on(AppEvent.ProviderChangeRequested, () => this.nav.changeProvider()),
      appEvents.on(AppEvent.SaveCurrentFile, () => this.saveCurrentFile()),
      appEvents.on(AppEvent.FlushAll, () => this.cache.flushDirtyFiles()),
      appEvents.on(AppEvent.NoFileView, ({ lastPath }) => {
        if (lastPath) this.view.setNoFileLastPath(lastPath);
        this.view.switchTo("no-file")
      }),
      appEvents.on(AppEvent.CreateFirstPage, () => {
        this.cache.createDraft(HOME_PATH, NEW_PAGE_BODY)
        this.view.switchTo("editor")
        appEvents.emit(AppEvent.Navigate, { path: HOME_PATH })
      }),
      appEvents.on(AppEvent.CreateDraftRequested, ({ path, content }) => {
        this.cache.createDraft(path, content)
      }),
      appEvents.on(AppEvent.DirIndexActivated, ({ path }) => {
        const dirName = path
          .replace(/\/_index$/, "")
          .split("/")
          .pop()
          ?.replace(/-/g, " ")
          .replace(/^\w/, (c: string) => c.toUpperCase()) ?? "";
        const template = `# ${dirName}\n\n<desc here>\n\n## Topics\n\n{{< table-of-directory >}}\n\n`;
        this.cache.createDraft(path, template)
        this.view.switchTo("editor")
        appEvents.emit(AppEvent.Navigate, { path })
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.view.switchTo(view)
      }),
      appEvents.on(AppEvent.SourceModeToggled, () => {
        this.editor.toggleSourceMode()
      }),
    )

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
      appEvents.emit(AppEvent.NoFileView, {})
    } else {
      replacePath(startPath)
    }

    const providerInfo = getProviderDisplayInfo(getProvider().name)
    appEvents.emit(AppEvent.ProviderChanged, {
      type: getProvider().name,
      icon: providerInfo.icon,
      label: providerInfo.label,
    })

    const metaPanel = mountMetaPanel(this.metaPanelTarget)
    this.nav.setMetaPanel(metaPanel)

    await this.cache.afterRestore()
    await this.editor.loadContent(startPath, (data) => this.nav.getMetaPanel()?.update(data))
    await this.nav.loadSidebar()
    dirtyTrackingService.recompute()

    this.onBeforeUnload = () => { dirtyTrackingService.flush(); flushSave() }
    window.addEventListener("beforeunload", this.onBeforeUnload)

    hotkeys.register("ctrl+s", () => appEvents.emit(AppEvent.SaveCurrentFile))
    hotkeys.attach()

    hideLoadingOverlay()
  }

  disconnect() {
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

  toggleSource = () => this.editor?.toggleSourceMode()
  applySource = () => this.editor?.applySourceContent()
  flush = () => this.cache?.flushDirtyFiles()

  private async saveCurrentFile(): Promise<void> {
    const path = this.nav.getCurrentPath()
    if (!path) return

    const pendingCreate = this.cache.getPendingOps().all.find(
      (e) => e.type === PendingOpType.Create && e.path === path
    )
    if (pendingCreate) {
      await this.cache.flushDirtyFiles()
      return
    }

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
    const existing = new Set(tree.paths)

    const entries: ZipFileEntry[] = rawEntries.map((e: ZipEntry) => ({
      ...e,
      exists: existing.has(e.relPath.replace(/\.md$/, "")),
    }))

    openImportZipDialog(
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
        treeStore.setTree(await provider.getTree())
        await this.nav.loadSidebar()
        await this.editor.loadContent(this.initialPath, (data) => this.nav.getMetaPanel()?.update(data))
        showNotification(`Imported ${result.selected.length} file${result.selected.length > 1 ? "s" : ""}`, { type: "info" })
      },
    )
  }

  private async resolveInitialPath(): Promise<{ path: string; isNew: boolean }> {
    const requested = this.initialPath || HOME_PATH
    const tree = treeStore.getTree()
    const pages = treePaths(tree)

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
