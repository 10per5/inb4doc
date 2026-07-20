/**
 * AppEvents — typed event bus for inter-controller communication.
 *
 * Components emit user-intent events (clicks, changes).
 * Controllers subscribe and react.
 * State changes flow back via events that components subscribe to.
 */

import type { ViewType } from "@/controllers/view-controller"
import type { MetaPanelData } from "@/components/panels/meta-panel"
import type { ProviderType } from "@/providers/index"

// ── Event names ──

export enum AppEvent {
  // Navigation
  Navigate = "navigate",
  SidebarReload = "sidebar-reload",

  // Dirty / sync
  EditorChanged = "editor-changed",
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

  // UI toggles
  SidebarToggle = "sidebar-toggle",
  MetaPanelToggle = "meta-panel-toggle",
  PrefsOpened = "prefs-opened",
  ImageManagerOpened = "image-manager-opened",
  CreateFirstPage = "create-first-page",
  ProjectEmpty = "project-empty",

  // Meta panel
  MetaDataChanged = "meta-data-changed",

  // Editor
  SourceModeToggled = "source-mode-toggled",
}

// ── Strict payload map ──

export interface AppEventPayloads {
  [AppEvent.Navigate]:              { path: string }
  [AppEvent.SidebarReload]:         void

  [AppEvent.EditorChanged]:         { path: string; md: string }
  [AppEvent.DirtyChanged]:          { count: number; bytes: number; pendingCount: number; singleDirtyPath?: string; currentPath?: string; dirtyPaths: string[] }
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

  [AppEvent.SidebarToggle]:         void
  [AppEvent.MetaPanelToggle]:       void
  [AppEvent.PrefsOpened]:           void
  [AppEvent.ImageManagerOpened]:    void
  [AppEvent.CreateFirstPage]:       void
  [AppEvent.ProjectEmpty]:          void

  [AppEvent.MetaDataChanged]:       { data: MetaPanelData }

  [AppEvent.SourceModeToggled]:     void
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
