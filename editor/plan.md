# Per-Provider Pending Ops

## Problem
Pending ops (creates, deletes, renames, moves) are stored in a single localStorage key (`inb4doc-pending-ops`). When switching providers, ops from one provider leak into the other.

## Goal
Each provider gets its own isolated set of pending ops. Switching providers swaps the active set. Old ops are preserved and restored on switch-back.

## Changes (3 files)

### 1. `utils/storage.ts` — parameterized keys
- `savePendingOps(ops, key?)` / `loadPendingOps(key?)` / `clearPendingOpsStorage(key?)`
- Default key stays `"inb4doc-pending-ops"` for backward compat
- Accept optional provider suffix: `"inb4doc-pending-ops-remote"`, etc.

### 2. `repositories/pendingOpsRepository.ts` — auto-scope to current provider
- Import `getProvider` from provider-store
- Every `load()`/`save()`/`clear()` reads `getProvider().name` and builds the scoped key
- No factory, no `forProvider()`. Just a two-line key helper.

### 3. `provider-store.ts` — emit `ProviderChanged` from `switchProvider()`
- `switchProvider()` emits `AppEvent.ProviderChanged` after setting the provider
- Remove `ProviderChanged` emission from `navigation-controller.ts` (was doing it, shouldn't)

### 4. `controllers/file-sync-controller.ts` — subscribe to ProviderChanged
- In constructor, subscribe to `AppEvent.ProviderChanged`
- On event: `this.pendingOps = new PendingOps(pendingOpsRepository.load())`
- This swaps the in-memory ops to the new provider's ops

## Data flow after change

```
User switches "remote" → "localStorage":

1. navigation-controller calls switchProvider("localStorage")
2. provider-store sets provider, emits ProviderChanged
3. FileSyncController receives event, reloads PendingOps from "inb4doc-pending-ops-localStorage"
4. Sidebar re-renders with localStorage's pending ops
5. Flush writes to localStorage provider, not remote
6. Old remote ops stay in "inb4doc-pending-ops-remote", restored on switch-back
```

## What gets removed
- `navigation-controller.ts`: remove `AppEvent.ProviderChanged` emission (provider-store does it)
- `changeProvider()` becomes simpler: save/clear pageRepository, call switchProvider(), reload pageRepository, load sidebar
