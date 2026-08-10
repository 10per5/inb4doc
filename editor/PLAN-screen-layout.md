# PLAN — Extendable Screen Layout (screen.layout)

## Goal
Introduce a reusable **screen** layout — `header (title + close/back) / body (scrollable)
/ bottom (pinned, optional)` — based on the sidebar-fullview pattern, and migrate every
"subscreen" to it: Disk Stats, Meta Panel, Preferences (mobile screen), Image Manager
(mobile screen), and the More screen. The layout should be a base other screens extend
("base/template.layout").

## Current architecture (map)

### View switching
- `ViewController` (`src/services/view-controller.ts`) owns views inside `#editor-area`.
  `ViewType = "editor" | "disk-usage" | "no-file" | "dir-index-empty" | "navigation" | "more" | "meta"`.
  `setupMobileViews()` (only when `AppFunc.MobileDock` — GuiMobile AND WebLocal) creates
  `navigation` / `more` / `meta` fullview divs (`className = "fullview-view …"`,
  `data-controller = "navigation" | "more" | "meta-panel"`). `setupDiskUsageView()` runs for
  ALL builds (disk usage is also in the desktop view menu, menu-definitions.ts:311).
- `DockController.viewToDockItem()` maps views → dock item (`navigation` → navigation,
  `more|meta|disk-usage` → more, else editor). FAB/dock emit `AppEvent.ViewChanged`.

### Screen markup today (mobile fullviews)
- `navigation.eta`: `.fullview-inner > .fullview-header (.fullview-title "Files" + .fullview-close xmark) + .fullview-body (.fullview-sidebar data-controller="sidebar")`.
- `more.eta`: same `.fullview-inner` shell, title "More", body = `.more-list > .more-item`s.
- `meta-panel.eta`: NO header — `.meta-panel-wrapper > .meta-panel + .meta-panel-footer`.
  Shared by desktop aside (`#meta-panel-mount .book-aside`) and mobile fullview (`metaEl`).
- `disk-usage.eta`: `.disk-usage-wrapper > .disk-usage-header (title + .disk-usage-close) + mode toggle + chart/stats`. Close uses `it.x`.

### The X-icon bug
- `src/eta/icons.ts` `export const x` (line ~1368) is the **X/Twitter logo** (diagonal
  double-stroked glyph). Used in exactly 2 places:
  - `disk-usage-controller.ts:5` → `disk-usage.eta:4` close button ← the "fucking X formerly
    twitter logo" complaint.
  - `meta-panel/meta-panel.ts:1` + `:55` extra-field remove button.
- Correct glyph is `xmark` (icons.ts:1375). Back affordance `arrowLeft` (icons.ts:77).
  Fix both usages to `xmark`; leave `x` export in place.

### Dialogs (stay for desktop)
- Dialog host: `dialog-service.ts` (overlay + `<div data-controller>` + payload value),
  `base-dialog-controller.ts` (cancel/close/confirm/keydown).
- `prefs-dialog.ts` → `openPrefsDialog(actions)` opens `prefs-dialog` (PrefsDialogController
  renders `prefs-dialog.eta` = `.inb4doc-prefs-box`: sticky checkbox, dark checkbox, image
  radio group, Close). Sticky change → `prefsStore.setStickyToolbar(v)` + dispatches
  `PrefsDialogEvent.StickyChange`; shell listens → `toolbarStore.setStickyPreference(v)`.
- `image-manager-dialog.ts` → `openImageManagerDialog()` loads data then opens
  `image-manager-dialog` (ImageManagerDialogController renders `image-manager-dialog.eta` =
  `.inb4doc-window` + `.img-row` list). review/delete/copy via `data-action` handlers.
- `AppEvent.PrefsOpened` / `AppEvent.ImageManagerOpened` → shell_controller opens dialogs
  (desktop). `more-controller.openPrefs/openImageManager` currently emit these too.

### Mobile routing decision
`PrefsOpened`/`ImageManagerOpened` handlers in `shell_controller.ts` become
**mobile-aware**: if `hasFunc(AppFunc.MobileDock)` → `view.switchTo("prefs"|"images")`,
else open the dialog. This covers both the More list and the slim topbar menus with zero
`more-controller` changes.

## Design — the screen layout base

### `templates/views/screen.eta` (the "screen.layout" wrapper partial)
Compiled by `compileAll` into `src/eta/views/screen.ts` exporting `renderScreen` — the
same mechanism the menu partials (`templates/partials/menu/*` → `src/eta/menu/*`) use.
View templates (eta) cannot import modules, so each screen's controller passes
`renderScreen` (and `icons`) through `it` — the established "pass prebuilt renderable via
it" convention (same as `it.icons`). The wrapper is deliberately close-agnostic
(closeIcon "xmark" default, "back" for a future subscreen stack):

```
<div class="screen[ class]">
  <header class="screen-header"><h1 class="screen-title">…</h1><button class="screen-close" data-action=…>xmark|arrowLeft</button></header>
  <div class="screen-body"><%~ it.body %></div>
  <footer class="screen-footer"[ hidden]><%~ it.bottom %></footer>
</div>
```

Screen templates call it as `it.renderScreen({ title, closeAction, closeLabel, icons,
closeIcon?, body })` (see navigation/more/disk-usage/meta/prefs/image-manager templates).
A TS `renderScreen` was NOT used — the codebase's wheel is compiled eta runtime modules
(`include()` is dead at runtime: each compiled module builds its own `new Eta()` with no
views, and `templates/partials/*` are build-time only except the special-cased
`partials/menu/`).

### `src/styles/ui/screen.css` (new; imported from styles/index.ts so it's mode-independent)
- `.screen { display:flex; flex-direction:column; height:100%; min-height:0 }` (works both
  inside absolute `.fullview-view` and inside block `[data-controller="disk-usage"]{height:100%}`).
- `.screen-header` (48px, border-bottom, space-between — mirrors old `.fullview-header`),
  `.screen-title` (17px/600 — mirrors `.fullview-title`), `.screen-close` (36×36 ghost
  button, 20px icon — mirrors `.fullview-close`), `.screen-body` (flex:1; overflow-y:auto),
  `.screen-footer` (flex-shrink:0; border-top; background secondary).
- `.book-aside .screen-header { display: none }` — desktop aside hides the header chrome.
- Remove the now-redundant `.fullview-inner/header/title/close/body` block from
  `templates/styles/mobile-dock.eta`; keep `.fullview-view` (absolute container) +
  `.more-list/.more-item` + dock/FAB/edit-toolbar.

## Per-screen work

### 1. Disk Stats
- `disk-usage.eta`: render via `it.renderScreen({ title: "Disk Stats", closeAction:
  "click->disk-usage#close", closeLabel: "Close disk stats", body: `…` })`; content wrapped
  in `.disk-usage-content` (padding 1rem 1.5rem). Mode toggle + chart + stats keep their
  `data-disk-usage-target` attrs.
- `disk-usage-controller.ts`: drop `import { x }`; pass `renderScreen` to the template.
- `disk-usage.css`: remove `.disk-usage-wrapper/.disk-usage-header/.disk-usage-close`;
  add `.disk-usage-content`.

### 2. Meta panel
- `meta-panel.eta`: wrap in `renderScreen({ title: "Meta panel", closeAction:
  "click->meta-panel#close", closeLabel: "Close meta panel", body: `<div class="meta-panel">…</div>`, bottom: "" })`.
  GitHub link stays in body (as today). Desktop aside hides the header via CSS
  `.book-aside .screen-header { display: none }` — same template/controller both places.
- `meta-panel-controller.ts`: add `close()` → `ViewChanged {view:"editor"}`; pass
  `renderScreen` to template; swap `x` → `xmark` for extra-field remove.
- `meta.css`: keep `.meta-panel` content styles; no layout breakage (aside is flex column).

### 3. Preferences → mobile screen (desktop dialog unchanged)
- Add `"prefs"` to `ViewType`; register view in `setupMobileViews()` (div
  `data-controller="prefs-screen"`, `className="fullview-view"`).
- `shell_controller.ts`: `PrefsOpened` → if `hasFunc(MobileDock)` `view.switchTo("prefs")`
  else dialog. (`hasFunc(MobileDock)` is already runtime-gated for web-local via
  `isMobileViewport()` in build-mode.ts, so desktop web-local still opens the dialog.)
- New `src/controllers/prefs-screen-controller.ts` (registered under MobileDock in core.ts):
  renders `renderScreen({ title: "Preferences", closeAction: "click->prefs-screen#close",
  closeLabel: "Back to files", closeIcon: "back", body: form })`; `close()` → ViewChanged
  editor. `connect()` renders once (like the other fullviews).
- Shared markup: `templates/views/prefs-fields.eta` → `src/eta/views/prefs-fields.ts`
  (`renderPrefsFields({ stickyToolbar, darkMode, imageStorageMode, controller })`, where
  `controller` is `"prefs-dialog"` | `"prefs-screen"` for the Stimulus change actions).
  `prefs-dialog.eta` renders `.inb4doc-prefs-box` containing `<%~ it.form %>` + Close.
- Shared logic: `src/components/ui/prefs.ts` — `onPrefsStickyChanged` / `onPrefsDarkChanged`
  / `onPrefsImageModeChanged` (prefsStore + data-theme attr). Both controllers delegate to
  these. Sticky wires through new `AppEvent.StickyPreferenceChanged: { sticky }`; shell
  subscribes → `toolbarStore.setStickyPreference`. `PrefsDialogEvent`/`onStickyToolbarChange`
  removed; `openPrefsDialog()` takes no args.

### 4. Image manager → mobile screen (desktop dialog unchanged)
- Add `"images"` to `ViewType`; register view in `setupMobileViews()` (div
  `data-controller="image-manager-screen"`, `className="fullview-view"`).
- `shell_controller.ts`: `ImageManagerOpened` → if MobileDock `view.switchTo("images")`
  else dialog.
- New `src/controllers/image-manager-screen-controller.ts` (MobileDock core.ts): `load()`
  awaits `loadImageManagerData()`, renders screen (title "Image Manager", xmark close),
  binds row actions; `close()` → ViewChanged editor. Data loads ON ACTIVATION (the
  view-controller calls `ctrl.load()` on activate, mirroring disk-usage) — NOT in
  `connect()`, because the provider isn't ready at boot (connect fires when the element is
  appended during `initialize()`).
- Shared rows markup: `templates/views/image-manager-rows.eta` → `src/eta/views/
  image-manager-rows.ts` (`renderImageManagerRows(data)` — `.img-row` list with
  `.img-review/.img-delete/.img-copy` buttons, no data-action attrs).
- Shared logic: `src/components/ui/image-manager.ts` — `loadImageManagerData()` (dir/
  loadError/allEntries, moved from `openImageManagerDialog`) + `bindImageManagerActions(
  container, { onAllImagesDeleted })` (review/delete/copy via addEventListener).
- `image-manager-dialog.eta` body → `<%~ it.rows %>`; `image-manager-dialog-controller.ts`
  connect renders `rows` and binds; review/delete/copy methods removed; delete-all →
  `cancel()`. `openImageManagerDialog` uses `loadImageManagerData()`.

### 5. More screen
- `more.eta`: `renderScreen({ title: "More", closeAction: "more#close",
  closeLabel: "Close more", body: `.more-list` })`.
- `view-controller.ts`: `moreEl.className = "fullview-view"` (drop `more-view` bottom-sheet);
  remove `.more-view` CSS from mobile-dock.eta (More is now a full-height screen).
- `more-controller.ts`: keep emitting PrefsOpened/ImageManagerOpened; `connect` selector
  check `.screen`.

### 6. Navigation screen (reference migration)
- `navigation.eta`: `renderScreen({ title: "Files", closeAction: "navigation#close",
  closeLabel: "Close files", body: sidebar })`. Controller passes `renderScreen`.

## File manifest
- NEW `templates/views/screen.eta` (→ `src/eta/views/screen.ts` `renderScreen`),
  `src/styles/ui/screen.css`, `templates/views/prefs-fields.eta`,
  `templates/views/image-manager-rows.eta`, `src/components/ui/prefs.ts`,
  `src/components/ui/image-manager.ts`, `src/controllers/prefs-screen-controller.ts`,
  `src/controllers/image-manager-screen-controller.ts`,
  `templates/views/controller/{prefs-screen,image-manager-screen}.eta`,
  `PLAN-screen-layout.md`.
- EDIT `templates/views/controller/{navigation,more,meta-panel,disk-usage}.eta`,
  `templates/styles/mobile-dock.eta`, `src/controllers/{navigation,more,disk-usage}-controller.ts`,
  `src/controllers/meta-panel/{meta-panel,meta-panel-controller}.ts`,
  `src/controllers/dialog/{prefs-dialog,prefs-dialog-controller,image-manager-dialog,image-manager-dialog-controller}.ts`,
  `templates/views/dialog/{prefs-dialog,image-manager-dialog}.eta`,
  `src/controllers/core.ts`, `src/controllers/shell_controller.ts`,
  `src/controllers/dock-controller.ts`, `src/services/view-controller.ts`,
  `src/stores/app-events.ts`, `src/styles/index.ts`,
  `src/styles/panels/disk-usage.css`, `src/styles/app/dialogs.css`.

## Order of work
1. screen.eta + screen.css + styles index import; tsc.
2. Migrate navigation + more (reference migrations) + remove fullview-* CSS; tsc + build.
3. Disk stats (incl. icon fix) + meta panel (incl. icon fix + close()).
4. prefs-fields + prefs screen (event + shell routing + view type) + dialog refactor.
5. image-manager rows + image screen (activation-loaded) + dialog refactor.
6. Dock mapping + core registration + ViewType; tsc + both builds (web-local + gui-mobile).

## Verification
- `bun --bun tsc --noEmit`; `bun lib/build.ts` + `BUILD_MODE=gui-mobile bun lib/build.ts`.
- grep bundle: no `.fullview-inner`, `.fullview-header`, `.disk-usage-header`, `more-view`,
  `meta-view` in compiled CSS; `screen-*`/`.img-message` present; `xmark` used for disk/meta
  close (no `import { x }` anywhere in src).
- `public/` left in default web-local build (gui-mobile build last would leave a thin
  public/ — rebuild web-local to restore).
- Live/e2e only if explicitly requested (AGENTS.md).

## Notes / future
- Prefs subscreens: `screen.eta` supports `closeIcon: "back"` and the header is stable; a
  screen stack (push/pop) can be added later without touching screen markup.
- `x` (Twitter) icon export left in `icons.ts` (unused after fix).
