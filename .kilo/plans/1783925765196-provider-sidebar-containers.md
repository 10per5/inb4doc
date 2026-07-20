# Plan: Favorited provider containers in sidebar + station panel dialog

## Goal
Restyle the sidebar so each **favorited content provider** is a **collapsible container node** (special
provider/gear icon, tooltip with config) that **wraps its own file tree**. The sidebar lists **one container per
favorited station**; the active station is expanded on open, others are collapsed by default but **never
auto-collapsed** (so future cross-container drag/drop works). A **hover star** toggles a provider in/out of
favorites (persisted). Repurpose `provider-dialog.ts` into a **provider/station panel**: 3 provider-type options
plus a scrollable "saved stations" list for managing favorites / "Create new provider".

Scope (confirmed with user):
- **Single active provider** at a time (only its tree is authoritative/editable). Multiple collapsed containers
  may be visible, but CRUD acts on the active one. Cross-container move (DnD copy between providers) is future.
- Persist **remote stations** (host/port + label) in localStorage now. `filesystem`/`localStorage` are
  single-entry favorites (FS Access handle is NOT serialized — deferred). Focus is the UI flow.

## Context / current state
- `provider-store.ts`: one global `ContentProvider` (`globalProvider`); `switchProvider(type)` swaps it and loads
  its tree. Only `LAST_PROVIDER_KEY` persisted (just the type). `getProviderDisplayInfo(type)` → {icon,label,type}.
- `sidebar.ts`: renders a top-level `.sidebar-provider-bar` with `provider-label` + "Switch" button
  (`actions.onChangeProvider()`). Below: search + `renderItems(tree)` + "+ New".
- `provider-dialog.ts`: `mountProviderDialog(currentProvider)` → `{ type } | null`; "Change Project" header, 3
  option cards, inline remote host/port + probe.
- `navigation-controller.ts`: `loadSidebar()` builds `SidebarActions` + `mountSidebar(..., pdi.icon, pdi.label,
  provider.name, ...)`. `changeProvider()` opens dialog, calls `switchProvider(result.type)`.
- `treeStore`: holds the **single active** tree. Needs to support per-station trees (see §3).
- Staged (foundation, already in tree): `remote-provider.ts` `appFallback`; `connection-store.ts`
  `getConfig()/setConfig(host,port)/remoteAvailable`; dialog probe UI.

## Changes

### 1. `editor/src/stores/provider-store.ts` — stations registry (source of truth for sidebar list)
- `interface ProviderStation { id: string; type: ProviderType; label: string; host?: string; port?: number }`
- `const STATIONS_KEY = "inb4doc-stations"`, `const LAST_STATION_KEY = "inb4doc-last-station"`.
- `listStations(): ProviderStation[]` — parse `STATIONS_KEY` (default `[]`); tolerate bad JSON.
- `addStation(s: Omit<ProviderStation,"id">): ProviderStation` — gen `id` (crypto.randomUUID), push, persist, return.
- `removeStation(id)` — filter + persist (guard: never remove the active station — see §4).
- `getStation(id)`, `setLastStation(id)` / `getLastStation()`.
- `seedStationsIfEmpty()` — on first run (empty list), add the active/discovered provider as a station and set it
  last, so the sidebar is never empty.
- Keep existing `switchProvider`, `getProviderDisplayInfo`, `cacheKeyForProvider`.

### 2. `editor/src/stores/tree-store.ts` — per-station tree cache
- Add `setTreeForStation(id, tree)` / `getTreeForStation(id)` / `ensureStationTree(id)` so multiple containers can
  render simultaneously. Active station's tree is authoritative; non-active containers show their cached/last tree
  (or `{}` if never loaded). `getTree()` keeps returning the active tree for the rest of the app.

### 3. `editor/src/components/panels/sidebar.ts` — list of provider containers
Replace `mountSidebar` so it renders **one container per station** instead of a single tree + top bar.
- New signature:
  `mountSidebar(container, stations: ProviderStation[], activeStationId: string, stationTrees: Record<string,TreeNode>, current, actions, pendingOps?, dirtyPaths?, rawTrees?: Record<string,TreeNode>)`
- `SidebarActions` changes:
  - Drop `onChangeProvider`; add:
    - `onActivateStation(stationId)` — make this station active (switch provider, load its tree).
    - `onToggleFavorite(stationId)` — add/remove from stations registry.
    - `onConfigureProvider(stationId)` — open the provider/station dialog for this station.
  - Keep `onNavigate/onNewItem/onDelete/onRname/onMove` (operate on the **active** station's tree).
- For each station render a `provider-container` (reuse `.nav-section` styling):
  - Header: provider **icon** (☁️/💻/🗄️) + `label` + a **hover star `☆/★`** button (favorite toggle) + a **gear
    `⚙`** button (configure) + caret toggle.
  - `title` (tooltip) on header/gear = config string (`Server (Remote) · host:port`, `Browser Storage`,
    `Local Files`).
  - Collapse/expand via existing `collapsedSections` map keyed by `station.id` (independent per container, **no
    auto-collapse of others** when one is activated). Double-click title or caret toggles; single click on the
    title (non-caret) area calls `onActivateStation(id)`.
  - Body: `(search wrapper if !treeEmpty) + renderItems(stationTrees[id] ?? {}, "", 0, rawTrees?.[id]) + "+ New"`.
  - Active station container expanded on render; others collapsed by default (respect stored `collapsedSections`).
- Remove the old `.sidebar-provider-bar` block entirely.
- Keep `renderItems` as-is (it renders the per-station tree). Keep search/drag/drop/keyboard logic — it already
  scopes to `.nav-item`/`.nav-section` within `container`, so it works per container.

### 4. `editor/src/components/dialogs/provider-dialog.ts` — provider/station panel
- `ProviderDialogResult = { type: ProviderType; stationId?: string; host?: string; port?: number; label?: string }`.
- Header: "Providers" (subtitle "Create new provider or manage stations").
- Body regions:
  - **Saved stations** (scrollable, `max-height`): rows from `listStations()`. Remote rows show `host:port`. Each
    row: icon + label + type + remove (×). Click row → resolve `{ type, stationId, host, port, label }`. Mark the
    active station.
  - **Create new provider**: the 3 option cards. Remote keeps host/port inputs + probe. Add a **"Save as station"**
    name field; on Accept for remote, call `addStation({type:'remote',host,port,label})`. filesystem/localStorage
    Accept resolves `{ type }` and upserts a single favorite entry.
- Keep `providerBadges` + `renderRemoteSection()` probe logic. Add CSS `.station-list/.station-row/
  .station-row-current/.station-remove`.

### 5. `editor/src/controllers/navigation-controller.ts`
- `loadSidebar()`:
  - `seedStationsIfEmpty()`; `stations = listStations()`; `activeId = getLastStation() ?? stations[0].id`.
  - Build `stationTrees`: `set/get` via `treeStore` (active = current tree; others = cached or `{}`).
  - Pass new `actions`: `onActivateStation(id) => this.activateStation(id)`,
    `onToggleFavorite(id) => toggleFavorite`, `onConfigureProvider(id) => this.changeProvider(id)`.
- `activateStation(id)`: apply config (remote → `connectionStore.setConfig(host,port)`), `switchProvider(type)`,
  `setLastStation(id)`, load tree into `treeStore` for station, `loadSidebar()`, navigate home/empty as today.
- `changeProvider(stationId?)`: open dialog; on result: if `host/port` (remote) `setConfig` first; `switchProvider`;
  if `stationId` `setLastStation(stationId)` else (newly created) `addStation` already done in dialog; reload.
- `toggleFavorite(id)`: `removeStation(id)` but **guard**: if `id === activeStationId`, keep it (or auto-activate
  another station first). Removing a non-active station just drops it from the sidebar list.

### 6. CSS
- Reuse `.nav-section`/`.nav-section-title`. Add `.provider-container`, `.provider-star` (visible on
  `:hover`/`:focus-within`), `.provider-gear`, `.provider-container.collapsed`. Stay within existing theme vars.

## Risks / notes
- FS Access handle can't be serialized → filesystem "station" is a single favorite (no host/port); multi-folder FS
  persistence deferred.
- Only the active station's tree is authoritative/editable; non-active containers show cached/`{}` trees and are
  view + activate only (CRUD disabled there for now). Mark cross-container move as future.
- Loading a non-active remote tree lazily needs the provider reachable; if not, show empty/`No files` (no crash).
- Staged `connection-store.ts`/`remote-provider.ts` must land first.
- Keep `SidebarActions`/signatures coherent so other callers compile.

## Validation
- `cd editor && bunx tsc --noEmit` (or `bun build.ts`) to confirm types.
- Manual: open app → sidebar lists favorited stations as collapsed containers; active one expanded with its tree.
  Hover shows star; click star adds/removes a favorite (removing active is prevented). Tooltip shows config. Gear
  opens the provider/station panel. Panel lists saved stations (scrollable) + 3 create options; creating a remote
  with host/port saves to favorites and switches. Clicking a non-active container header activates it (loads its
  tree, expands) without collapsing the others. Collapse/expand per container is independent. Existing search,
  drag/drop, rename/delete still work inside the active container. Reload app → favorites persist, active expanded.
