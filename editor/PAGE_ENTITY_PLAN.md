# Page Entity — Refactor Plan

## Why

Per-page state (body, baseline, patches, frontmatter, server time, dirty flag)
was scattered across a flat `stores/cache.ts` singleton and provider IO was
invoked ad-hoc from `editor-service.ts` and `cache-management-service.ts`.
This refactor extracts that into proper domain entities and a thin sync service.

## Architecture

```
                 ┌─────────────────────────────┐
                 │  ContentProvider (IO)        │  outer layer
                 │  readFile / writeFile / …    │
                 └──────────────┬──────────────┘
                                │ Page.flushIn / flushOut
                        ┌───────▼────────┐
                        │     Page        │  domain entity
                        │  name / body /  │
                        │  changes / dirty│
                        └───────┬────────┘
                                │ reads/writes
                        ┌───────▼────────┐
                        │ PageRepository  │  data store + persistence
                        │  pages Map      │
                        └─────────────────┘

┌──────────────────┐     ┌──────────────────┐
│   PendingOps     │     │  FileSyncService  │  application service
│  queue/cancel    │◄────│  orchestration    │
│  persistence     │     │  flush / discard  │
└──────────────────┘     └──────────────────┘
```

### Domain Entities (`entities/`)

| File | Entity | Responsibility |
|------|--------|---------------|
| `Page.ts` | `Page` | Aggregate root. Composes Body + Frontmatter + PageMeta. Owns `name`, `reconstructContent()`, `setBody()`, `setBaseline()`, `deletePatch()`, `flushIn()`, `flushOut()`. |
| `Body.ts` | `Body` | Editable body: current text, original baseline, diff patch. Owns delta computation and patch application. |
| `Frontmatter.ts` | `Frontmatter` | Value object wrapping `MetaPanelData`. Parse/serialize/title access. |
| `PageMeta.ts` | `PageMeta` | Interface: dirty flag + server time. |
| `PendingOps.ts` | `PendingOps` | Queue of unflushed file operations (create/delete/rename/move). Owns cancel logic, count, tree application, localStorage persistence. |

### Stores (`stores/`)

| File | Store | Responsibility |
|------|-------|---------------|
| `pageRepository.ts` | `PageRepository` | `Map<path, Page>` + dirty queries + `sync()` + provider state save/restore. |
| `pendingOpsStore.ts` | `pendingOpsStore` | Thin localStorage wrapper for PendingOps serialization. |

### Services (`services/`)

| File | Service | Responsibility |
|------|---------|---------------|
| `file-sync-service.ts` | `FileSyncService` | Application-level orchestration: commits pending images, delegates to `Page.flushOut`/`flushIn`, executes pending ops, manages dirty counters, coordinates UI callbacks (notifications, sidebar reload). |
| `editor-service.ts` | `EditorService` | Milkdown lifecycle. Uses `pageRepository` for cache reads/writes. |
| `navigation-service.ts` | `NavigationService` | Navigation + sidebar. Uses `pageRepository` for state queries. |

### Utils

| File | Exports | Note |
|------|---------|------|
| `utils/tree.ts` | `applyPendingOps()`, `setPath()`, `collectLeaves()` | `PendingOp` type moved to `entities/PendingOps.ts`. |
| `utils/display-name.ts` | `pageDisplayName()` | Single source of truth for display names. |
| `utils/storage.ts` | `savePendingOps()`, `loadPendingOps()`, `clearPendingOpsStorage()` | Unchanged — used by `pendingOpsStore.ts`. |

## Page Entity API

```ts
class Page {
  readonly path: string
  readonly bodyState: Body
  meta: PageMeta
  frontmatter?: Frontmatter

  get name(): string                              // display-name.ts
  reconstructContent(): string | undefined        // frontmatter + body
  setBody(body: string): void                     // sets body + patch, updates dirty
  setBaseline(baseline: string): boolean | null   // re-applies patch
  deletePatch(): void                             // clears patch + body, marks clean
  setFrontmatter(data: MetaPanelData): void
  removeFrontmatter(): void
  getFrontmatter(): MetaPanelData | undefined
  setServerTime(time: number): void
  getServerTime(): number | undefined
  markDirty(): void

  flushIn(): Promise<boolean>                     // read provider → merge into page
  flushOut(imageUrlMap?): Promise<boolean>        // write page → provider
}
```

### `flushIn()` flow
1. `provider.readFile(path)` → parse frontmatter + body
2. `setBaseline(body)`, set frontmatter, set server time
3. Return success boolean

### `flushOut(imageUrlMap?)` flow
1. Get body, replace pending image URLs if map provided
2. Serialize frontmatter + body into full content
3. `provider.writeFile(path, fullContent)`
4. `deletePatch()`, `setBaseline(body)`, `cacheBody(body)`
5. Update server time from provider
6. Return success boolean

## PendingOps Entity API

```ts
class PendingOps {
  constructor(saved?: PendingOp[])
  get all(): PendingOp[]
  get count(): number
  queueCreate(path: string, content: string): void
  queueDelete(path: string): void
  queueRename(from: string, to: string, content?: string): void
  queueMove(from: string, to: string, content?: string): void
  clear(): void
  hasPendingDelete(path: string): boolean
  hasPendingCreate(path: string): boolean
  hasPendingMoveTo(path: string): boolean
  applyToTree(tree: TreeNode): TreeNode
}
```

Cancel logic: queueing a create cancels a delete for the same path (and vice
versa). Renames/moves capture the page content at queue time for offline
persistence.

## FileSyncService API

```ts
class FileSyncService {
  constructor(callbacks: FileSyncCallbacks)
  setCurrentPath(path: string): void
  getPendingOps(): PendingOps

  // Pending ops
  queueCreate(path, content): void
  queueDelete(path): void
  queueRename(from, to): void
  queueMove(from, to): void

  // Dirty state
  updateDirtyCounter(): void
  getDirtyState(): { count, bytes, pendingCount }

  // Flush
  flushCurrentFile(path, content): Promise<void>
  flushDirtyFiles(): Promise<void>

  // Discard
  discardFileChanges(path): Promise<void>

  // Changes dialog
  handleDirtyClick(): Promise<void>

  // Draft creation
  createDraft(path, content): void

  // Post-restore fixup
  afterRestore(): Promise<void>

  // Tree helpers
  pathExists(path): Promise<boolean>
  applyPendingOpsToTree(tree): TreeNode
}
```

## Migration phases (completed / in progress)

- **Phase 0 ✓:** Created `entities/Page.ts`, `Body.ts`, `Frontmatter.ts`,
  `PageMeta.ts`. Created `stores/pageRepository.ts`. Created
  `utils/display-name.ts`. Deleted `stores/cache.ts`.
- **Phase 1 (now):** Migrate all 7 stale `@/stores/cache` imports to
  `pageRepository`. Create `PendingOps` entity + store. Rename
  `CacheManagementService` → `FileSyncService`. Move flush logic into
  `Page.flushOut`/`Page.flushIn`. Update all service type references.
- **Phase 2 (future):** Migrate remaining `editor-service.ts` fetch logic to
  use `Page.flushIn` for external-change detection.

## File manifest (this turn)

### New files
- `entities/PendingOps.ts`
- `stores/pendingOpsStore.ts`
- `services/file-sync-service.ts`

### Modified files
- `entities/Page.ts` — enhanced `flushOut(imageUrlMap?)`, `flushIn()` returns boolean
- `orchestrator.ts` — `FileSyncService` import
- `services/navigation-service.ts` — type import + `pageRepository.*`
- `services/editor-actions.ts` — type import + `pageRepository.*`
- `plugins/dirty.ts` — `pageRepository.*`
- `features/mention.ts` — `pageRepository.*`
- `components/panels/sidebar.ts` — `pageRepository.*`
- `services/view-management-service.ts` — `pageRepository.*`
- `services/editor-service.ts` — `pageRepository.*`
- `utils/tree.ts` — remove `PendingOp` type (moved to entity)

### Deleted files
- `services/cache-management-service.ts` (replaced by file-sync-service.ts)

## References

- `editor/src/entities/Page.ts` — aggregate root
- `editor/src/entities/Body.ts` — body + diff tracking
- `editor/src/entities/Frontmatter.ts` — frontmatter value object
- `editor/src/entities/PageMeta.ts` — dirty flag + server time
- `editor/src/stores/pageRepository.ts` — page data store
- `editor/src/utils/display-name.ts` — display name derivation
- `editor/src/providers/provider.ts` — IO interface
