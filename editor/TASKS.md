# Tasks — Prioritized Investigation & Plan

Resorted by impact (regressions/data-correctness first, then editing
correctness, then tablet interaction, then features). Items marked
`NEEDS VERIFY` may already be partially addressed or need a runtime check.

## P0 — Data correctness / regressions

### T1. Pasted images not converted to files on save (`provider-relative`?)
- **Files:** `plugins/image-paste.ts`, `services/image-service.ts`
  (`uploadImage` L109, `addPending` L120, `commitAllPendingImages` L141,
  `confirmCommitted` L176), `config/editor-config.ts` L74 (URL passthrough),
  flush pipeline in `services/file-sync-service.ts`, markdown serializer
  `config/editor-markdown.ts` (`image-block` L901), `utils/text.ts`
  `replacePendingUrls`, `entities/Page.ts` `flushOut` L104.
- **Findings (ROOT CAUSE FOUND):** The flush↔substitution wiring is correct —
  `commitAllPendingImages()` returns `urlMap[pending-image:${id}] → realUrl`,
  and `Page.flushOut` does `replacePendingUrls(body, urlMap)`. The bug is the
  **`realUrl` itself**: `fs-provider.uploadImage` (L307) returns a
  **root-absolute** path `` `/${dir}/image/${name}` ``. Images are stored at
  `<docdir>/image/${name}`, so a doc in `blog/` needs the link
  `image/foo.png` (doc-relative), not `/blog/image/foo.png` (root-absolute),
  which doesn't resolve from the markdown.
- **Plan / Fix:** `fs-provider.uploadImage` now returns `relPath`
  (`image/${name}`) — doc-relative. `resolveImageUrl` already falls back to
  `${currentDir}/${normalized}` so editor blob display survives. Other
  providers (remote/mount/saf) return whatever their backend/bridge returns —
  those URLs are backend-controlled and out of JS scope; the same doc-relative
  expectation must be satisfied there.
- **Status:** **IMPLEMENTED** (fs-provider). Needs device/desktop runtime
  verify (open a page in a subfolder, paste an image, save, confirm the
  markdown link is `image/foo.png` and renders).

### T2. Can't convert bullet point → header (regression)
- **Files:** `services/command-service.ts` `wrapInHeadingCommand` L29,
  `services/editor-mutation-service.ts` (Heading case),
  `utils/editor-mutator.ts` `clearListItems`.
- **Findings:** `wrapInHeadingCommand` = `setBlockType(heading,{level})`.
  Inside a list, the top block is a `list` node; a heading isn't a valid
  child of a list item, so `setBlockType` returns false → no-op (looks like
  "can't convert").
- **Plan:** In the `ToolbarCommand.Heading` case of
  `editor-mutation-service`, if `selectionInsideList(state)`, call
  `clearListItems(view)` first, then `wrapInHeadingCommand` on the fresh
  `view.state`.
- **Status:** **IMPLEMENTED** — bullet/numbered item → heading now lifts the
  item out of the list first.

## P1 — Toolbar toggles (correctness)

### T3. Re-selecting list button flips `* ↔ -` instead of clearing
- **Files:** `utils/editor-mutator.ts` `setListItemKind` L124,
  `services/editor-mutation-service.ts` L41-46.
- **Findings:** `setListItemKind(view,"bullet")` always calls
  `createToggleListCommand({kind})` (prosemirror-flat-list). Re-clicking the
  *same* kind re-wraps/toggles the bullet marker style (`*`→`-`) rather than
  removing the list. Desired: re-select clears the list (same as ExitList).
  Task list already special-cased (unchecks) — leave that behavior.
- **Plan:** In `setListItemKind`, detect current list `kind` via
  `block-context`/`ActiveBlockType`; if `current === requested` (bullet or
  ordered), call `clearListItems(view)` instead of `toggleList`. Apply to
  both bullet and ordered.
- **Status:** **IMPLEMENTED** — re-selecting the active bullet/ordered kind
  now clears the list; task list still toggles (per user). (User noted the
  original symptom wording may be stale, but the desired end-state matches.)

### T4. Re-clicking H2 removes header state
- **Files:** `services/command-service.ts` `wrapInHeadingCommand` L29,
  `services/editor-mutation-service.ts` L35-36.
- **Findings:** `setBlockType(heading,{level})` is not idempotent — clicking
  H2 on an H2 block does nothing (or re-sets same). Expected: toggle back to
  paragraph.
- **Plan:** In `wrapInHeadingCommand`, if the block at the selection is
  already a `heading` of the requested `level`, `setBlockType(paragraph)`
  instead. Mirrors `wrapInBlockquoteCommand` toggle pattern (L64).
- **Status:** **IMPLEMENTED** — `wrapInHeadingCommand` reverts to paragraph
  when the block is already a heading of the requested level (toggle-off),
  mirroring `wrapInBlockquoteCommand`. (User noted the original symptom wording
  may be stale; end-state matches.)

## P1 — Tablet core interaction

### T5. edit-toolbar (quick menu) position not recalculated on content growth
- **Files:** `controllers/edit-toolbar-controller.ts` (`positionPopover`,
  `connect`, `onScroll`), `plugins/block-context.ts` (dedup L66),
  `plugins/dirty.ts` (`EditorChanged` L48), `stores/app-events.ts`.
- **Findings (refined by user):** The follow-mode quick bar is positioned from
  the caret/block rect. `BlockContextChanged` is deduped on
  `blockStart + contextJSON`, so typing that grows a paragraph *within the same
  block* does NOT re-emit → `positionPopover` never re-runs → the menu floats
  **above** the now-taller block. `EditorChanged` (`dirty.ts` L48) fires on
  every doc change with no upstream debounce — the right live trigger.
- **Fix (IMPLEMENTED):** `connect()` now subscribes to `AppEvent.EditorChanged`;
  when `this.followMode` is true it calls `positionPopover()`. `followMode` is
  already gated to touch/tablet (viewport + UA), so desktop is untouched.
  `preferAbove:false` keeps the popover below the block; it only flips above
  when the block reaches the visual-viewport (keyboard) bottom.
- **Status:** **IMPLEMENTED** (tsc clean). Tablet runtime verify needed.

## P2 — Tablet chrome & features

### T6. Copy image / block-with-image as data (+ cross-editor paste)
- **Files:** `plugins/image-paste.ts` (`handlePaste` L37 consumes `image/*`
  from clipboard; `handleDOMEvents.copy/cut` ADDED), `services/image-service.ts`
  (`getImageFile(id)` ADDED, `addPending` keeps `file` L122).
- **Findings:** Default copy serializes selection to HTML; images become
  `<img src="pending-image:…">`/blob refs that don't survive a paste elsewhere.
  The paste side already ingests `image/*` clipboard items (`handlePaste`), so
  the missing half is the **copy side** writing real bytes. `ImageService`
  keeps the original `File` for pending images, so bytes are available
  synchronously during the copy event.
- **Fix (IMPLEMENTED):**
  1. `image-paste.ts` adds `handleDOMEvents.copy`/`cut`: scans the selection for
     an `image`/`image-block` node whose `src` is `pending-image:<id>`; if the
     pending `File` exists, wraps it as `new File([file], name, {type})` and
     adds it to `event.clipboardData.items` as `image/*`. Returns `false` so
     ProseMirror still writes the usual text/html + text/plain (same-app paste).
  2. **Cross-editor paste (item 6):** pasting the `image/*` bytes into another
     inb4doc editor hits the existing `handlePaste` → `uploadImage(file)` →
     `pending-image:` token → uploaded on flush. External apps read `image/*`
     directly. Works without any data-URL round-trip.
- **Limitation:** only *pending* (in-session, not-yet-flushed) images have
  synchronous bytes; committed images fall back to the default reference copy.
- **Status:** **IMPLEMENTED** (tsc clean). Device verify (copy a just-pasted
  image, paste into a second editor / external app).

### T7. Tablet: task list missing from top bar; "+" only in empty mode
- **Files:** `controllers/topbar-controller.ts` (`renderOverflowItems` L778,
  topbar.eta mobileDock branch L69-71), `controllers/edit-toolbar-controller.ts`
  (FAB "+" always visible L54/219).
- **Findings:** The tablet *mobileDock* top bar **does** render a Task-list
  button (topbar.eta L69). The real bug: on a narrow tablet width `relayout()`
  overflows the center section and `renderOverflowItems` **dropped**
  `toolbar-list-wrap` (and `toolbar-heading-wrap`), so the whole list dropdown
  — Task list included — is hidden and never promoted into the "…" menu. Hence
  the task list "doesn't show up" on tablet. (The desktop topbar has the same
  overflow-dropping behavior.)
- **Fix (IMPLEMENTED):** `renderOverflowItems` no longer drops the heading/list
  wraps; instead it promotes their inner dropdown actions (H1–H3, bullet/
  ordered/task/check/clear) into the "…" overflow menu, so the Task list stays
  reachable at any width. The "+" (edit-toolbar FAB) is already always visible;
  the user's "+" observation likely refers to the same width-collapse hiding —
  confirm on device.
- **Status:** **IMPLEMENTED** (tsc clean). The "+" sub-symptom needs device
  confirmation; if it's a *different* "+" (dock FAB hidden at tablet widths per
  edit-toolbar comment L26), that's by design and not changed.

### T8. Tablet: zoom hides sidebar; sidebar by orientation; View menu state
- **Files:** `services/layout-service.ts` (`currentWidth` L159 uses
  `UIService.isTablet()`, `apply` L170 emits `AppEvent.LayoutChanged`,
  `setLeftPanel`), `stores/ui-store.ts` (`isTablet`/`isMobile`),
  `controllers/topbar-controller.ts` (View menu subscribes to `LayoutChanged`),
  `utils/mobile.ts`.
- **Findings:** On tablet, `bootDefaults` sets `leftPanel:true` regardless of
  orientation (`layout-service.ts` L36). The user wants: **portrait/vertical →
  sidebar hidden; landscape/horizontal → sidebar may show**, and the View→
  topbar menu toggle must reflect the change. `apply()` already emits
  `AppEvent.LayoutChanged` (L183), and the View menu re-sources on it, so the
  menu state refresh is largely free once visibility is driven by orientation.
- **Proposed fix (NOT implemented — device-specific, touches the shared
  LayoutService used by mobile/desktop too):**
  - Add an orientation listener: `window.matchMedia("(orientation: portrait)")`
    (or `screen.orientation`), and in `apply()` / a tablet-only branch, when
    `currentWidth()===Tablet`, set `leftPanel` off in portrait and on (default)
    in landscape — but decide whether this **overrides** an explicit user toggle
    or only sets the *initial* default on orientation change.
  - Emit `LayoutChanged` on orientation change so the View menu `checked` state
    refreshes (already happens via `apply()`).
- **Open question for user:** should rotating to portrait *force* the sidebar
  closed (overriding a manual open), or only affect the *default* and respect a
  manual toggle until the user changes it? This determines whether we gate in
  `apply()` or only on the orientation `change` event.
- **Status:** **IMPLEMENTED** (tsc clean) — orientation now sets the tablet
  left-panel *default* (portrait→hidden, landscape→shown) via
  `applyOrientationDefault()`, but only until the user manually toggles the
  sidebar (`userToggledLeft`, set in `toggleLeftPanel`/`toggleRightPanel`), so
  manual choices are respected. `apply()` already emits `LayoutChanged` so the
  View menu `checked` state refreshes. Needs tablet device verify.

### T9. Image/Video editor focus first input on open
- **Files:** `controllers/dialog/base-dialog-controller.ts` (`focusInput`
  L26), `controllers/dialog/image-dialog-controller.ts` (already focuses
  `#urlId` on connect L27), `controllers/dialog/video-dialog-controller.ts`
  (did **not** focus).
- **Findings:** Image dialog already focuses its URL input on connect; the
  video dialog's `connect()` rendered the form but never called `focusInput`,
  so the first input (src) was not focused when opening via `/video`, FAB, or
  toolbar.
- **Plan:** Add `focusInput(\`#${inputId}\`, { raf: true })` to
  `VideoDialogController.connect()`.
- **Status:** **IMPLEMENTED** (video dialog now focuses its src input on
  open).

## P3 — Feature

### T10. ctrl+shift+e scrolls nav to currently open document (desktop)
- **Files:** `plugins/keyboard.ts` (global keybindings L812),
  `stores/app-events.ts` (new `SidebarScrollToCurrent`),
  `controllers/sidebar/sidebar-controller.ts` (`itemByPath` map L66,
  `getCurrentPath()`).
- **Findings:** No existing binding. Sidebar already keeps `itemByPath`
  (path→element) and `getCurrentPath()` gives the open doc.
- **Plan:** Add global binding `Ctrl/Mod-Shift-E` → emit
  `AppEvent.SidebarScrollToCurrent`; sidebar subscribes and
  `scrollIntoView({ block: "center", behavior: "smooth" })`s the active
  item. Not gated to desktop (works on web too, harmless on tablet).
- **Status:** **IMPLEMENTED**.

---

## Implementation order / status
- **DONE (tsc clean, needs device/runtime verify):** T1 (fs-provider doc-relative
  image URL), T2 (bullet→header), T3 (list re-select clears), T4 (H re-click
  toggles off), T5 (quick-menu recalc on paragraph growth), T6 (copy image as
  data + cross-editor paste), T7 (task list reachable in overflow), T9 (video
  dialog focus), T10 (ctrl+shift+e scroll-to-current).
- **INVESTIGATED, NOT IMPLEMENTED (device-specific / needs decision):** T8
  (tablet sidebar by orientation) — proposed fix in its section; blocked on the
  "override user toggle vs default-only" decision + tablet device verify.
- **Out of scope (deferred earlier):** #8 source editor (sentinel rejected) —
  future agent via ProseKit/markdown parsing. Mention (#10) restored + working.

## Verification
- `bun --bun tsc --noEmit` passes for all code edits.
- Desktop items (T1, T2, T3, T4, T6, T9, T10) need a real run to confirm UX.
- Tablet items (T5, T7, T8) need a tablet/phone (touch + OSK) run; T8 also needs
  the orientation-override decision.
