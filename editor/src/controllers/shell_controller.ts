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

import { createQuickPage } from "@/features/editor-actions";
import { resolveImports, applyImportBody, readExistingBody } from "@/features/import-resolve";
import type { MetaPanelData } from "@/entities/Frontmatter";
// Auto-naming settles when typing pauses, not on every keystroke.
const AUTO_RENAME_DEBOUNCE_MS = 1200
import { isAutoNamed, markAutoNamed, clearAutoNamed, inferTargetPath } from "@/features/auto-name";
import { recentProjectsStore } from "@/stores/recent-projects-store";
import { ProviderType } from "@/providers/index";
import { getCurrentPath, replacePath } from "@/utils/url";
import {
  markDocumentSwitch,
  setUiLayerCount,
  startUiHistory,
  stopUiHistory,
} from "@/services/ui-history-service";
import { closeTopMenu } from "@/components/ui/menu";
import { imageService } from "@/services/image-service";
import * as hotkeys from "@/utils/hotkeys";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { getInitialState, getContentRoot } from "@/bridge/native";
import { registerBackHandler } from "@/services/back-service";
import { closeTopDialog } from "@/services/dialog-service";
import { closeTopWindow } from "@/services/window-service";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { changesScreenStore } from "@/stores/changes-screen-store";
import { PendingOpType } from "@/entities/PendingOps";
import { updateEditorTint } from "@/utils/file-status-tint";
import { storageService } from "@/services/storage-service";
import { isMobileDock } from "@/utils/mobile";
import type { PrefsSection } from "@/config/enums/prefs-section";

let sessionStarted = 0;

export function setSessionStarted(time: number) {
  sessionStarted = time;
}

function treePaths(tree: ReturnType<typeof treeStore.getTree>): string[] {
  return Array.from(tree.paths)
}

export default class Shell extends Controller {
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
  private autoRenameTimer: ReturnType<typeof setTimeout> | null = null

  connect() {
    this.initialPath = this.data.get("path") || getCurrentPath()

    // One unwinder for every Back source: the native bridge calls it through
    // window.inb4docUI, and browser/PWA session history calls it through
    // services/ui-history-service. Until the view service exists (it is built
    // in initializeApp) handleBack reports "unhandled", so the host keeps its
    // own fallback and a press during boot still exits.
    registerBackHandler(() => this.handleBackPressed())
    startUiHistory()

    // Runtime deep-link entry point for the desktop shell's single-instance IPC
    // (gui/src/app.cpp): when a second launch forwards an inb4doc:// URI, the
    // GUI evaluates window.__inb4docOpenExternal(uri) into the live editor.
    ;(window as unknown as Record<string, unknown>).__inb4docOpenExternal = (
      uri: string,
    ) => {
      void import("@/services/share-service").then(({ openShareOpenDialog }) =>
        openShareOpenDialog(uri),
      )
    }
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

    // GuiDesktop: the CLI may have launched against a single .md file. If so,
    // open that document directly (path is relative to the content root, .md
    // stripped) and start in single-document mode (navtree hidden).
    if (hasFunc(AppFunc.MountProvider)) {
      try {
        const init = await getInitialState();
        if (init.path) this.initialPath = init.path;
        if (init.single) LayoutService.getInstance().setSingleDocument(true);
      } catch {
        // No single-document launch — fall back to the home/navigator view.
      }
    }

    this.editor.setCurrentPath(this.initialPath)
    this.cache.setCurrentPath(this.initialPath)
    this.nav.setCurrentPath(this.initialPath)

    dirtyTrackingService.setPathResolver(() => this.nav.getCurrentPath())
    dirtyTrackingService.setCanonicalBaselineResolver((p) => {
      const baseline = pagesStore.get(p)?.bodyState.baseline
      return baseline === undefined ? undefined : this.editor.canonicalize(baseline)
    })
    dirtyTrackingService.start()

    this.unsubs.push(
      appEvents.on(AppEvent.FlushComplete, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.ModulesSwapped, () => this.nav.loadSidebar()),
      appEvents.on(AppEvent.PrefsOpened, async ({ section }) => {
        if (isMobileDock()) {
          this.view.switchTo("prefs")
          if (section !== undefined) {
            // Land straight on the requested section (the sidebar Filters
            // button opens navigation preferences directly). The screen only
            // mounts after the view switch, so stash the request for it.
            await import("@/controllers/prefs-controller")
            const el = this.editor.element.querySelector<HTMLElement>('[data-controller="prefs"]')
            const ctrl = el
              ? (this.editor.application.getControllerForElementAndIdentifier(el, "prefs") as
                  | { openSectionValue?: (section: PrefsSection) => void }
                  | null)
              : null
            ctrl?.openSectionValue?.(section)
          }
          return
        }
        const { openPrefsWindow } = await import("@/controllers/prefs-controller")
        openPrefsWindow(section)
      }),
      appEvents.on(AppEvent.AboutOpened, async () => {
        if (isMobileDock()) {
          this.view.switchTo("about")
          return
        }
        const { openAboutWindow } = await import("@/controllers/about-controller")
        openAboutWindow()
      }),
      appEvents.on(AppEvent.StickyPreferenceChanged, ({ sticky }) => {
        this.toolbarStore!.setStickyPreference(sticky)
      }),
      appEvents.on(AppEvent.ImageManagerOpened, async () => {
        if (isMobileDock()) {
          this.view.switchTo("images")
          return
        }
        const { openImageManagerWindow } = await import("@/controllers/image-manager-controller")
        openImageManagerWindow()
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
      appEvents.on(AppEvent.NewFileRequested, () => {
        // File → New and the explorer's "+ New": the file is created under a
        // throwaway three-word slug and takes its real name from the first
        // `# heading` you type (see features/auto-name).
        const current = this.nav.getCurrentPath()
        const parentDir = current.includes("/")
          ? current.substring(0, current.lastIndexOf("/"))
          : ""
        createQuickPage(this.cache, parentDir, (p: string) => this.nav.navigate(p), () => this.nav.loadSidebar())
      }),
      // Auto-naming: while a file created unnamed still carries a heading, that
      // heading keeps renaming it. Debounced, so the rename settles once typing
      // pauses instead of firing on every keystroke.
      appEvents.on(AppEvent.EditorChanged, ({ path, md }) => {
        if (!isAutoNamed(path)) return
        if (inferTargetPath(path, md) === null) return
        if (this.autoRenameTimer !== null) clearTimeout(this.autoRenameTimer)
        this.autoRenameTimer = setTimeout(() => {
          this.autoRenameTimer = null
          if (!isAutoNamed(path)) return
          const renameTarget = inferTargetPath(path, md)
          if (renameTarget === null) return
          clearAutoNamed(path)
          markAutoNamed(renameTarget)
          this.nav.renameTo(path, renameTarget)
        }, AUTO_RENAME_DEBOUNCE_MS)
      }),
      appEvents.on(AppEvent.FormatDocumentRequested, () => {
        dirtyTrackingService.formatDocument(
          this.nav.getCurrentPath(),
          this.editor.getCurrentContent(),
        )
      }),
      appEvents.on(AppEvent.DirtyChanged, () => this.refreshFormatSuggestion()),
      // Content set / reload also changes formattability (e.g. opening a
      // non-canonical file with no pending edits yet).
      appEvents.on(AppEvent.OutlineChanged, () => this.refreshFormatSuggestion()),
      appEvents.on(AppEvent.SaveRequested, () => {
        exportToZip().then(() => this.nav.loadSidebar())
      }),
      appEvents.on(AppEvent.ShareSendRequested, () => {
        const content = this.editor.getCurrentContent()
        const title = this.nav.getCurrentPath()?.split("/").pop()?.replace(/-/g, " ")
        void import("@/services/share-service").then(({ openShareSendDialog }) =>
          openShareSendDialog(content, title),
        )
      }),
      appEvents.on(AppEvent.ShareOpenRequested, () => {
        void import("@/services/share-service").then(({ openShareOpenDialog }) =>
          openShareOpenDialog(),
        )
      }),
      appEvents.on(AppEvent.OpenSharedDocRequested, ({ path, content }) => {
        this.cache.createDraft(path, content)
        this.view.switchTo("editor", "document")
        appEvents.emit(AppEvent.Navigate, { path })
        this.nav.loadSidebar()
        dirtyTrackingService.recompute()
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
        this.view.switchTo("editor", "document")
        appEvents.emit(AppEvent.Navigate, { path: HOME_PATH })
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
        this.view.switchTo("editor", "document")
        appEvents.emit(AppEvent.Navigate, { path })
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view, reason }) => {
        this.view.switchTo(view, reason)
        // A document opening releases the layer's history entry (navigate
        // replaces it); any other editor switch lets the manager pop it.
        if (reason === "document") markDocumentSwitch()
        setUiLayerCount("view", view === "editor" ? 0 : 1)
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

    // Record the boot content root in Recent Projects so a dir opened via the
    // GUI CLI (or restored as the persisted last project) shows up there just
    // like an in-app File → Open Project… does — those never call
    // recentProjectsStore.add() themselves. Web modes have a server-owned root,
    // so gate on ProjectPicker (GuiDesktop | GuiMobile). GuiMobile's Saf
    // provider roots at the app's built-in docs tree, which is the default when
    // no project has been picked — never a user-opened project — so skip it.
    if (hasFunc(AppFunc.ProjectPicker) && getProvider().name !== ProviderType.Saf) {
      try {
        const root = await getContentRoot()
        if (root?.path) {
          recentProjectsStore.add(root.path, root.name)
          // Remember the mounted root so a later project switch can store this
          // project's current document and restore the next one's.
          this.nav.setActiveProject(root.path)
        }
      } catch {
        // Host without the getContentRoot op — nothing to record.
      }
    }

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
    this.checkInitialShareUri()
  }

  // #6: keep the File → Format document item's enabled state in sync.
  // DirtyChanged fires after every recompute (load, navigate, edit, discard),
  // so it's the single signal covering every case where formattability changes.
  private refreshFormatSuggestion(): void {
    appEvents.emit(AppEvent.FormatSuggestionChanged, {
      path: this.nav.getCurrentPath(),
      formattable: this.editor.isFormattable(),
    })
  }

  /**
   * Deep-link bootstrap (spec §8): if the app was launched with an
   * `inb4doc://` URI, open the import dialog prefilled with it.
   *
   * Sources, in priority order:
   *  - `window.__INB4DOC_OPEN_URI__`: set by the GUI shell (gui/src/args.cpp)
   *    before the editor bundle loads, carrying a `inb4doc://` argv/intent.
   *  - `location.hash` (`#inb4doc://…`) — web/PWA fallback (spec §7.3).
   *  - `?inb4doc=…` query param.
   */
  private checkInitialShareUri(): void {
    const candidate = this.detectInitialShareUri()
    if (!candidate) return
    void import("@/services/share-service").then(({ openShareOpenDialog }) =>
      openShareOpenDialog(candidate),
    )
  }

  private detectInitialShareUri(): string | null {
    const w = window as unknown as { __INB4DOC_OPEN_URI__?: string }
    if (typeof w.__INB4DOC_OPEN_URI__ === "string" && w.__INB4DOC_OPEN_URI__.startsWith("inb4doc://")) {
      return w.__INB4DOC_OPEN_URI__
    }
    const hash = location.hash.replace(/^#/, "")
    const hashMatch = hash.match(/inb4doc:\/\/[^\s]+/)
    if (hashMatch) return hashMatch[0]
    const q = new URLSearchParams(location.search).get("inb4doc")
    if (q) return "inb4doc://" + q
    return null
  }

  /**
   * The app's single unwinder, shared by both Back sources: the native bridge
   * (`window.inb4docUI.handleBack`) and browser/PWA session history
   * (`services/ui-history-service`). Unwinds exactly one layer, innermost
   * first: an open dialog, the topmost window, an open menu, then whatever a
   * controller owns (a pushed sub-screen, the file multi-select), then the
   * fullview itself.
   *
   * With "More" gone every fullview — Files included — steps straight back to
   * the editor. Only once the editor is frontmost does this report
   * "unhandled" — the host's cue to fall through to history and then exit — so
   * a press can never quit the app from a subscreen.
   */
  private handleBackPressed(): boolean {
    // A modal dialog is above every window in the stack, so it unwinds first;
    // then the topmost window (and only that one — a parent stays open below),
    // then a dropdown (menus float above the page but below modal surfaces).
    if (closeTopDialog()) return true
    if (closeTopWindow()) return true
    if (closeTopMenu()) return true
    const request = { handled: false }
    appEvents.emit(AppEvent.BackRequested, request)
    if (request.handled) return true
    if (!this.view) return false
    if (this.view.getCurrent() === "editor") return false
    this.view.switchTo("editor")
    return true
  }

  disconnect() {
    registerBackHandler(null)
    stopUiHistory()
    if (this.autoRenameTimer !== null) {
      clearTimeout(this.autoRenameTimer)
      this.autoRenameTimer = null
    }
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

        // Resolve names BEFORE anything is written: a imported file whose name
        // belongs to a directory is moved aside (`inb4doc` → `inb4doc-file`)
        // so it can never take the folder over.
        const resolved = resolveImports(
          result.selected as ZipEntry[],
          tree.paths,
          result.mode,
        )

        let imported = 0
        let renamed = 0
        for (const item of resolved) {
          if (!item.entry) continue
          const { stripFrontmatter, serializeFrontmatter } = await import("@/utils/frontmatter")
          const incoming = stripFrontmatter(item.entry.content)
          let content = item.entry.content

          if (item.exists) {
            const current = await readExistingBody(item.path)
            const currentParsed = stripFrontmatter(current)
            const body = await applyImportBody(
              currentParsed.body,
              incoming.body,
              item.mode,
            )
            const merged = { ...(currentParsed.frontmatter ?? {}), ...(incoming.frontmatter ?? {}) }
            content = Object.keys(merged).length > 0
              ? `---
${serializeFrontmatter(merged as MetaPanelData)}
---

${body}`
              : body
          }

          // Pending Edit (not a direct write) so the import is reviewable and
          // its diff shows up in Pending Changes.
          await this.cache.importContent(item.path, content)
          if (item.path === this.nav.getCurrentPath()) {
            await this.editor.ensureEditor(stripFrontmatter(content).body)
          }
          if (item.renamedFrom) renamed++
          imported++
        }

        pagesStore.clearPath(this.nav.getCurrentPath())
        await this.nav.loadSidebar()
        dirtyTrackingService.recompute()
        appEvents.emit(AppEvent.MetaPanelReload)

        const parts: string[] = [`Imported ${imported} file${imported === 1 ? "s" : ""}`]
        if (renamed > 0) {
          parts.push(
            `${renamed} renamed ("-file") to avoid overtaking a folder of the same name`,
          )
        }
        showNotification(parts.join(" — "), { type: "info" })
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
