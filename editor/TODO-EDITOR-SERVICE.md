# TODO: Service → Controller Refactor + Event Bus

## Problem

`editor-service.ts` (~670 lines) mixes 6+ concerns. "Services" are actually
controllers (stateful, handle user actions). The orchestrator is a god object
that wires every callback — a hidden event bus made of thin wrappers.

## Phase 0: Event bus (`stores/app-events.ts`)

Decouple controllers. Orchestrator just creates + initializes.

```ts
// Enum for type-safe event names
export enum AppEvent {
  Navigate = "navigate",
  FlushComplete = "flush-complete",
  SidebarReload = "sidebar-reload",
  DirtyChanged = "dirty-changed",
  ContentChanged = "content-changed",
  ViewChanged = "view-changed",
  ProviderChanged = "provider-changed",
  ContentNeeded = "content-needed",
  ContentReady = "content-ready",
  SearchNavigate = "search-navigate",
  SourceModeToggled = "source-mode-toggled",
}

// Strict event payload map
export interface AppEventPayloads {
  [AppEvent.Navigate]: { path: string }
  [AppEvent.FlushComplete]: void
  [AppEvent.SidebarReload]: void
  [AppEvent.DirtyChanged]: { count: number; bytes: number; pending: number }
  [AppEvent.ContentChanged]: { path: string; content: string }
  [AppEvent.ViewChanged]: { view: ViewType }
  [AppEvent.ProviderChanged]: { type: string }
  [AppEvent.ContentNeeded]: { path: string }
  [AppEvent.ContentReady]: { path: string; content: string }
  [AppEvent.SearchNavigate]: { query: string; matchIndex?: number; snippetText?: string }
  [AppEvent.SourceModeToggled]: void
}

// Typed event bus
export class EventBus<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<(data: any) => void>>()

  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
    return () => this.listeners.get(event)?.delete(handler)
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.listeners.get(event)?.forEach(handler => handler(data))
  }
}

// Singleton
export const appEvents = new EventBus<AppEventPayloads>()
```

Controllers import and use directly:
```ts
import { appEvents, AppEvent } from "@/stores/app-events"

// Emit
appEvents.emit(AppEvent.FlushComplete)

// Subscribe (returns unsubscribe function)
const unsub = appEvents.on(AppEvent.SidebarReload, () => this.reload())
```

## Phase 1: Extract from editor-controller

### 1. `ConflictResolver` (`services/conflict-resolver.ts`)

Pure decision function extracted from `fetchContent` lines 192-247.
Conflict = baseline != current disk body AND page is dirty.

```ts
type ConflictDecision =
  | { action: "accept-disk"; body: string; fm: MetaPanelData | null; time: number }
  | { action: "show-dialog"; localBody: string; localFm: MetaPanelData | undefined;
      diskRaw: string; diskBody: string; diskFm: MetaPanelData | null; diskTime: number }

function resolveConflict(
  page: Page | undefined,
  diskBody: string,
  diskFm: MetaPanelData | null,
  serverTime: number | null,
): ConflictDecision | null
```

### 2. `EditorStateCache` (`stores/editor-state-cache.ts`)

Extract `editorStates: Map<string, EditorState>` + `lastSetContent: Map<string, string>`.

```ts
class EditorStateCache {
  save(path, state) / get(path) / delete(path)
  getLastSet(path) / setLastSet(path, content)
  clear()
}
```

### 3. `ScrollToText` (`features/search/scroll-to-text.ts`)

```ts
function scrollToText(editor: Editor, query: string, matchIndex?: number, snippetText?: string): void
```

### 4. `EditorController` (`controllers/editor-controller.ts`)

Rename `services/editor-service.ts` → `controllers/editor-controller.ts`.
Class `EditorService` → `EditorController`. ~250 lines after extraction.

After refactor, publishes/subscribes via `appEvents` instead of config callbacks:
- Emits `AppEvent.ContentChanged` instead of `onContentChange` callback
- Emits `AppEvent.DirtyChanged` instead of `onDirtyChange` callback
- Subscribes to `AppEvent.Navigate` to update current path

## Phase 2: Rename services → controllers

### 5. `NavigationService` → `NavigationController`

Rename `services/navigation-service.ts` → `controllers/navigation-controller.ts`.

After refactor:
- Subscribes to `AppEvent.Navigate` for path changes
- Emits `AppEvent.ContentNeeded` / `AppEvent.ContentReady`
- Emits `AppEvent.SidebarReload` when sidebar needs refresh
- Emits `AppEvent.ProviderChanged` on provider switch

### 6. `FileSyncService` → `FileSyncController`

Rename `services/file-sync-service.ts` → `controllers/file-sync-controller.ts`.

After refactor:
- Emits `AppEvent.FlushComplete` after flush
- Emits `AppEvent.DirtyChanged` when dirty count changes
- Subscribes to `AppEvent.SidebarReload` to trigger sidebar updates

### 7. `AppOrchestrator` → `AppController`

Rename `orchestrator.ts` → `controllers/app-controller.ts`.
After refactor: just creates controllers + calls `initialize()`. No callback wiring.

## Phase 3: Service classification fixes

### 8. `toolbar-service.ts` → `stores/toolbar-store.ts`

### 9. `hotkey-manager.ts` → `utils/hotkeys.ts`

Flatten class to module functions. Remove auto-attach side effect.
```ts
export function register(key, handler): void
export function handle(e): void
export function attach(): void
```

### 10. `ui-initializer-service.ts` — delete

Inline mount logic into `AppController`.

### 11. `view-manager.ts` → `stores/view-manager.ts`

### 12. `ViewManagementService` → `ViewController`

Rename `services/view-management-service.ts` → `controllers/view-controller.ts`.

## File manifest

| File | Action |
|---|---|
| `stores/app-events.ts` | **New** — typed event bus |
| `services/conflict-resolver.ts` | **New** — pure conflict decision |
| `stores/editor-state-cache.ts` | **New** — extracted state maps |
| `features/search/scroll-to-text.ts` | **New** — extracted scroll |
| `controllers/editor-controller.ts` | **New** (from services/editor-service.ts) |
| `controllers/navigation-controller.ts` | **New** (from services/navigation-service.ts) |
| `controllers/file-sync-controller.ts` | **New** (from services/file-sync-service.ts) |
| `controllers/app-controller.ts` | **New** (from orchestrator.ts) |
| `controllers/view-controller.ts` | **New** (from services/view-management-service.ts) |
| `stores/toolbar-store.ts` | **New** (from services/toolbar-service.ts) |
| `stores/view-manager.ts` | **New** (from components/views/view-manager.ts) |
| `utils/hotkeys.ts` | **New** (from services/hotkey-manager.ts) |
| `services/editor-service.ts` | **Delete** |
| `services/navigation-service.ts` | **Delete** |
| `services/file-sync-service.ts` | **Delete** |
| `services/view-management-service.ts` | **Delete** |
| `services/toolbar-service.ts` | **Delete** |
| `services/hotkey-manager.ts` | **Delete** |
| `services/ui-initializer-service.ts` | **Delete** |
| `orchestrator.ts` | **Delete** |
| `components/views/view-manager.ts` | **Delete** |
| `controllers/shell_controller.ts` | **Update** |
| `bridge/index.ts` | **Update** |
| `bridge/find.ts` | **Update** |
| `app.ts` | **Update** |

## Execution order

1. `stores/app-events.ts` (new, no deps)
2. `services/conflict-resolver.ts` (new, no deps)
3. `stores/editor-state-cache.ts` (new, no deps)
4. `features/search/scroll-to-text.ts` (new, imports prosemirror-search)
5. `controllers/editor-controller.ts` (rename + refactor, imports 1-4)
6. `utils/hotkeys.ts` (flatten, independent)
7. `stores/toolbar-store.ts` (rename, independent)
8. `stores/view-manager.ts` (move, independent)
9. `controllers/navigation-controller.ts` (rename, uses appEvents)
10. `controllers/file-sync-controller.ts` (rename, uses appEvents)
11. `controllers/view-controller.ts` (rename, uses appEvents)
12. `controllers/app-controller.ts` (rename + refactor, just creates + initializes)
13. Update shell_controller, bridge/*, app.ts
14. Delete old files
15. `tsc --noEmit`
