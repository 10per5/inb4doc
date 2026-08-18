/**
 * ShellController — Stimulus composition root (merged from AppController).
 *
 * Finds child Stimulus controllers (editor, sidebar, topbar) via targets/outlets,
 * creates plain-class sub-services (NavigationService, FileSyncService,
 * ViewService), and wires event subscriptions.
 */

import { Controller } from "@hotwired/stimulus"
import type { EditorInstance } from "@/config/editor-config"
import { applyThemeFromPrefs } from "@/utils/theme";
import { ToolbarStore } from "@/stores/toolbar-store";
import { UIService } from "@/stores/ui-store";
import type { EditorController } from "@/controllers/editor-controller";
import { FileSyncService } from "@/services/file-sync-service";
import { ViewService } from "@/services/view-service";
import { LayoutService } from "@/services/layout-service";
import { NavigationService } from "@/services/navigation-service";
import { getProvider, getProviderDisplayInfo, waitProviderReady } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { NEW_PAGE_BODY } from "@/utils/constants"
import { pagesStore } from "@/stores/page-store";
import { HOME_PATH, isRootPath, resolveHomePageFromPaths } from "@/utils/hugo-compat";
import { exportToZip, pickAndParseZip } from "@/utils/zip";
import type { ZipEntry, ZipFileEntry } from "@/utils/zip";
import { showNotification } from "@/components/notification/notification";
import { prefsStore } from "@/stores/preferences-store";
import { getCurrentPath, replacePath } from "@/utils/url";
import { imageService } from "@/services/image-service";
import * as hotkeys from "@/utils/hotkeys";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { changesScreenStore } from "@/stores/changes-screen-store";
import { PendingOpType } from "@/entities/PendingOps";
import { updateEditorTint } from "@/utils/file-status-tint";
import { storageService } from "@/services/storage-service";
import { isMobileDock } from "@/utils/mobile";

let sessionStarted = 0;

export function setSessionStarted(time: number) {
  sessionStarted = time;
}

function treePaths(tree: ReturnType<typeof treeStore.getTree>): string[] {
  return Array.from(tree.paths)
}

export default class extends Controller {
  static targets = ["editorArea"]
  static outlets = ["editor"]

  declare readonly editorAreaTarget: HTMLElement

  private editor!: EditorController
  private cache!: FileSyncService
  private nav!: NavigationService
  private view!: ViewService

  private initialPath: string = ""
  private uiService: UIService = UIService.getInstance()
  private toolbarStore?: ToolbarStore
  private onBeforeUnload: (() => void) | null = null
  private unsubs: (() => void)[] = []
  private appInitialized = false

  connect() {
    this.initialPath = this.data.get("path") || getCurrentPath()
  }

  editorOutletConnected(outlet: EditorController) {
    if (this.appInitialized) return
    this.appInitialized = true

    this.editor = outlet
    this.initializeApp()
  }

  private async initializeApp() {
    await storageService.initialize()
    applyThemeFromPrefs()

    this.cache = new FileSyncService(this.editor as any)
    this.view = new ViewService(this.editor as any, sessionStarted)
    this.nav = new NavigationService(this.editor as any, this.cache)
    // Apply the boot layout preset (focused by default) so the View-menu panel
    // toggles are in effect from first paint.
    LayoutService.getInstance()

    this.editor.setCurrentPath(this.initialPath)
    this.cache.setCurrentPath(this.initialPath)
    this.nav.setCurrentPath(this.initialPath)

    dirtyTrackingService.setPathResolver(() => this.nav.getCurrentPath())
    dirtyTrackingService.start()

    this.unsubs.push(
      appEvents.on(AppEvent.FlushComplete, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.ModulesSwapped, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.PrefsOpened, async () => {
        if (isMobileDock()) {
          this.view.switchTo("prefs")
          return
        }
        const { openPrefsDialog } = await import("@/controllers/prefs-controller")
        openPrefsDialog()
      }),
      appEvents.on(AppEvent.StickyPreferenceChanged, ({ sticky }) => {
        this.toolbarStore!.setStickyPreference(sticky)
      }),
      appEvents.on(AppEvent.ImageManagerOpened, async () => {
        if (isMobileDock()) {
          this.view.switchTo("images")
          return
        }
        const { openImageManagerDialog } = await import("@/controllers/image-manager-controller")
        openImageManagerDialog()
      }),
      appEvents.on(AppEvent.DirtyClicked, async () => {
        if (isMobileDock()) {
          const data = await this.cache.buildChangesData();
          if (!data) return;
          changesScreenStore.set(data);
          this.view.switchTo("changes");
          return;
        }
        this.cache.handleDirtyClick();
      }),
      appEvents.on(AppEvent.SingleDiscardRequested, ({ path }) => this.cache.discardFileChanges(path)),
      appEvents.on(AppEvent.SaveRequested, () => {
        exportToZip().then(() => this.nav.loadSidebar())
      }),
      appEvents.on(AppEvent.LoadRequested, () => this.handleLoadZip()),
      appEvents.on(AppEvent.SidebarToggle, () => this.uiService.toggleSidebar()),
      appEvents.on(AppEvent.ProviderChangeRequested, () => this.nav.changeProvider()),
      appEvents.on(AppEvent.OpenProjectRequested, () => this.nav.openProject()),
      appEvents.on(AppEvent.RecentProjectRequested, ({ path }) => this.nav.openProject(path)),
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
        const template = isRootPath(path)
          ? `# Home\n\n<desc here>\n\n`
          : (() => {
              const dirName = path
                .replace(/\/_index$/, "")
                .split("/")
                .pop()
                ?.replace(/-/g, " ")
                .replace(/^\w/, (c: string) => c.toUpperCase()) ?? "";
              return `# ${dirName}\n\n<desc here>\n\n## Topics\n\n{{< table-of-directory >}}\n\n`;
            })();
        this.cache.createDraft(path, template)
        this.view.switchTo("editor")
        appEvents.emit(AppEvent.Navigate, { path })
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.view.switchTo(view)
      }),
      appEvents.on(AppEvent.SourceModeToggled, () => {
        const source = this.editor.toggleSourceMode()
        appEvents.emit(AppEvent.SourceModeChanged, { source })
      }),
      appEvents.on(AppEvent.SourceApplyRequested, ({ path, content }) => {
        this.cache.flushCurrentFile(path, content)
      }),
    )

    try { imageService.restoreFromStorage() } catch {}

    this.toolbarStore = new ToolbarStore({ stickyToolbar: prefsStore.stickyToolbar })
    this.toolbarStore.initialize()

    this.view.initialize()

    this.onBeforeUnload = () => { dirtyTrackingService.flush() }
    window.addEventListener("beforeunload", this.onBeforeUnload)

    hotkeys.register("ctrl+s", () => appEvents.emit(AppEvent.SaveCurrentFile))
    hotkeys.attach()

    this.loadBackground()
  }

  private async loadBackground() {
    await waitProviderReady()

    const { path: startPath, isNew } = await this.resolveInitialPath()
    this.initialPath = startPath
    this.editor.setCurrentPath(startPath)
    this.cache.setCurrentPath(startPath)
    this.nav.setCurrentPath(startPath)

    if (isNew) {
      this.editor.hideSkeleton()
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

    await this.cache.afterRestore()
    await this.editor.loadContent(startPath, () => appEvents.emit(AppEvent.MetaPanelReload))
    updateEditorTint(this.editor.element as HTMLElement, startPath, this.cache.getPendingOps())
    await this.nav.loadSidebar()
    this.editor.hideSkeleton()
    dirtyTrackingService.recompute()
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
    dirtyTrackingService.flush()

    const path = this.nav.getCurrentPath()
    if (!path) return

    const ops = this.cache.getPendingOps().all
    const hasPendingOp = ops.some(
      (e) =>
        (e.type === PendingOpType.Create && e.path === path) ||
        (e.type === PendingOpType.Delete && (e.path === path || path.startsWith(e.path + "/"))) ||
        (e.type === PendingOpType.Rename && (e.from === path || e.to === path || path.startsWith(e.from + "/"))) ||
        (e.type === PendingOpType.Move && (e.from === path || e.to === path || path.startsWith(e.from + "/")))
    )
    if (hasPendingOp) {
      await this.cache.flushDirtyFiles()
      return
    }

    const dirtyPaths = this.cache.getPendingOps().getDirtyPaths()
    if (!dirtyPaths.includes(path)) {
      showNotification("No changes to save", { type: "info", id: "save" })
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

    const { openImportZipDialog } = await import("@/controllers/dialog/import-zip-dialog")
    openImportZipDialog(
      entries,
      async (result) => {
        if (result.selected.length === 0) return
        const paths = result.selected.map((e: ZipFileEntry) => e.relPath.replace(/\.md$/, ""))
        await Promise.all(paths.map((path: string) => {
          const entry = rawEntries.find((r: ZipEntry) => r.relPath.replace(/\.md$/, "") === path)
          return entry ? provider.writeFile(path, entry.content) : Promise.resolve()
        }))
        pagesStore.clearAll()
        treeStore.setTree(await provider.getTree())
        await this.nav.loadSidebar()
        await this.editor.loadContent(this.initialPath, () => appEvents.emit(AppEvent.MetaPanelReload))
        showNotification(`Imported ${result.selected.length} file${result.selected.length > 1 ? "s" : ""}`, { type: "info" })
      },
    )
  }

  private async resolveInitialPath(): Promise<{ path: string; isNew: boolean }> {
    const requested = this.initialPath || HOME_PATH
    const tree = treeStore.getTree()
    const pages = treePaths(this.cache.getPendingOps().applyToTree(tree))

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
