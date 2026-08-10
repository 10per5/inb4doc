/**
 * AppEvents — typed event bus for inter-controller communication.
 *
 * Components emit user-intent events (clicks, changes).
 * Controllers subscribe and react.
 * State changes flow back via events that components subscribe to.
 */

import type { ViewType } from "@/services/view-controller"
import type { LayoutChangedPayload } from "@/services/layout-service"
import type { MetaPanelData } from "@/entities/Frontmatter"
import type { ProviderType } from "@/providers/index"
import type { ToolbarCommand, SlashCommand } from "@/config/enums"
import type { ActiveBlockContext } from "@/config/enums/block-context"
import type { FileEntry } from "@/config/storage-keys"


// ── Event names ──

export enum AppEvent {
  // Navigation
  Navigate = "navigate",
  SidebarReload = "sidebar-reload",
  SidebarActive = "sidebar-active",
  SidebarNewItemRequested = "sidebar-new-item-requested",
  SidebarDeleteRequested = "sidebar-delete-requested",
  SidebarRenameRequested = "sidebar-rename-requested",
  SidebarMoveRequested = "sidebar-move-requested",
  SidebarWeightsRequested = "sidebar-weights-requested",
  SidebarCancel = "sidebar-cancel",

  // Dirty / sync
  EditorChanged = "editor-changed",
  OutlineChanged = "outline-changed",
  DirtyChanged = "dirty-changed",
  DirtyClicked = "dirty-clicked",
  SingleDiscardRequested = "single-discard-requested",
  FlushComplete = "flush-complete",
  SaveRequested = "save-requested",
  SaveCurrentFile = "save-current-file",
  FlushAll = "flush-all",
  LoadRequested = "load-requested",

  // View / provider
  ViewChanged = "view-changed",
  ProviderChanged = "provider-changed",
  ProviderChangeRequested = "provider-change-requested",
  TreeChanged = "tree-changed",

  // Project (runtime directory reselection)
  OpenProjectRequested = "open-project-requested",
  RecentProjectRequested = "recent-project-requested",

  // UI toggles
  SidebarToggle = "sidebar-toggle",
  LayoutChanged = "layout-changed",
  PrefsOpened = "prefs-opened",
  StickyPreferenceChanged = "sticky-preference-changed",
  ImageManagerOpened = "image-manager-opened",
  CreateFirstPage = "create-first-page",
  CreateDraftRequested = "create-draft-requested",
  ProjectEmpty = "project-empty",
  NoFileView = "no-file-view",
  DirIndexEmpty = "dir-index-empty",
  DirIndexActivated = "dir-index-activated",

  // Meta panel
  MetaDataChanged = "meta-data-changed",
  MetaPanelReload = "meta-panel-reload",

  // Editor
  SourceModeToggled = "source-mode-toggled",
  SourceModeChanged = "source-mode-changed",
  SourceApplyRequested = "source-apply-requested",
  ToolbarCommandExec = "toolbar-command-exec",
  InsertBlockCommand = "insert-block-command",
  BlockContextChanged = "block-context-changed",
  ScrollToText = "scroll-to-text",
  LinkDialogRequested = "link-dialog-requested",

  // Storage
  ProviderFilesLoaded = "provider-files-loaded",

  // Module lifecycle
  UpdateAvailable = "update-available",
  SWInstallProgress = "sw-install-progress",
  SWUpdateReady = "sw-update-ready",
  ModulesSwapped = "modules-swapped",
  SWSwapFailed = "sw-swap-failed",
  SWUpdatePending = "sw-update-pending",
  SWUpdateResolved = "sw-update-resolved",
  UpdateRequiresReload = "update-requires-reload",
}

// ── Strict payload map ──

export interface AppEventPayloads {
  [AppEvent.Navigate]:              { path: string; query?: string; matchIndex?: number; snippetText?: string }
  [AppEvent.SidebarReload]:         void
  [AppEvent.SidebarActive]:         { path: string }
  [AppEvent.SidebarNewItemRequested]: { parentPath: string; isFolder: boolean }
  [AppEvent.SidebarDeleteRequested]:  { paths: string[] }
  [AppEvent.SidebarRenameRequested]:  { path: string }
  [AppEvent.SidebarMoveRequested]:    { from: string; to: string }
  [AppEvent.SidebarWeightsRequested]: { weights: { path: string; weight: number }[] }
  [AppEvent.SidebarCancel]:         void

  [AppEvent.EditorChanged]:         { path: string; md: string }
  [AppEvent.OutlineChanged]:        void
  [AppEvent.DirtyChanged]:          { count: number; bytes: number; singleDirtyPath?: string; currentPath?: string; dirtyPaths: string[] }
  [AppEvent.DirtyClicked]:          void
  [AppEvent.SingleDiscardRequested]:{ path: string }
  [AppEvent.FlushComplete]:         void
  [AppEvent.SaveRequested]:         void
  [AppEvent.SaveCurrentFile]:       void
  [AppEvent.FlushAll]:              void
  [AppEvent.LoadRequested]:         void

  [AppEvent.ViewChanged]:           { view: ViewType }
  [AppEvent.ProviderChanged]:       { type: ProviderType; icon: string; label: string }
  [AppEvent.ProviderChangeRequested]: void
  [AppEvent.TreeChanged]:           void

  [AppEvent.OpenProjectRequested]:  void
  [AppEvent.RecentProjectRequested]: { path: string }

  [AppEvent.SidebarToggle]:         void
  [AppEvent.LayoutChanged]:         LayoutChangedPayload
  [AppEvent.PrefsOpened]:           void
  [AppEvent.StickyPreferenceChanged]: { sticky: boolean }
  [AppEvent.ImageManagerOpened]:    void
  [AppEvent.CreateFirstPage]:       void
  [AppEvent.CreateDraftRequested]: { path: string; content: string }
  [AppEvent.ProjectEmpty]:          void
  [AppEvent.NoFileView]:           { lastPath?: string }
  [AppEvent.DirIndexEmpty]:        { path: string }
  [AppEvent.DirIndexActivated]:   { path: string }

  [AppEvent.MetaDataChanged]:       { data: MetaPanelData }
  [AppEvent.MetaPanelReload]:       void

  [AppEvent.SourceModeToggled]:     void
  [AppEvent.SourceModeChanged]:     { source: boolean }
  [AppEvent.SourceApplyRequested]:  { path: string; content: string }
  [AppEvent.BlockContextChanged]:   { context: ActiveBlockContext }
  [AppEvent.ToolbarCommandExec]:    { command: ToolbarCommand; level?: number }
  [AppEvent.InsertBlockCommand]:    { command: SlashCommand; level?: number }
  [AppEvent.ScrollToText]:          { query: string; matchIndex: number; snippetText?: string }
  [AppEvent.LinkDialogRequested]:   void

  [AppEvent.ProviderFilesLoaded]:  Record<string, FileEntry>

  [AppEvent.UpdateAvailable]: void
  [AppEvent.SWInstallProgress]: { loaded: number; total: number; done: boolean }
  [AppEvent.SWUpdateReady]: void
  [AppEvent.ModulesSwapped]: { names: string[] }
  [AppEvent.SWSwapFailed]: { name: string }
  [AppEvent.SWUpdatePending]: void
  [AppEvent.SWUpdateResolved]: void
  [AppEvent.UpdateRequiresReload]: { reason: string }
}

// ── EventBus ──

export class EventBus<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<(data: any) => void>>()

  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
    return () => { this.listeners.get(event)?.delete(handler) }
  }

  emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends void ? [] : [data: Events[K]]
  ): void {
    this.listeners.get(event)?.forEach(handler => handler(args[0] as Events[K]))
  }

  off<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler)
  }

  removeAll(): void {
    this.listeners.clear()
  }
}

// ── Singleton ──

export const appEvents = new EventBus<AppEventPayloads>()


