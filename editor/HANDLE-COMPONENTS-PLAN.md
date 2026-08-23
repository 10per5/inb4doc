# Handle Components Plan — Table Handle (P1) + Block Handle Swap (P2) [+ Milkdown Cleanup (P3)]

Adopting **native ProseKit components** (`@prosekit/web` vanilla custom
elements) for desktop table AND prose-block manipulation. Both phases use the
official `@prosekit/web/table-handle` / `@prosekit/web/block-handle` element
trees — we do NOT patch `BlockHandleView` (`src/features/block-edit.ts`) or
route desktop through `edit-toolbar-controller.ts`. Those remain the
mobile/tablet quick-bar implementations, untouched. Prereq: `TABLE-PLAN.md`
(all table fixes there are DONE; this file covers only the new UI).

Desktop gate everywhere: `!isMobileDock()` (`src/utils/mobile.ts`), same
pattern as `createCaretScrollPlugin()` in `editor-config.ts`. No BuildMode
string checks.

## Phase 1 — Table handle (desktop)

### What you get

Hover any table → grip above the hovered column + grip left of the hovered row
(Notion-style). Click opens a local menu: insert left/right / above/below,
clear contents, delete column/row/table. Grips are also DRAG handles that
reorder rows/columns (`moveTableRow/moveTableColumn` — zero UI today) with a
live drop indicator.

### Verified API facts (no re-derivation needed)

- `@prosekit/web/table-handle` (already a dep) + menu elements from
  `@prosekit/web/menu`. All light-DOM aria-ui custom elements (no shadow DOM).
- Elements & tags:
  - `<prosekit-table-handle-root>` — prop `editor`
  - `<prosekit-table-handle-drag-preview>` — prop `editor`
  - `<prosekit-table-handle-drop-indicator>` — prop `editor`
  - `<…column-positioner placement="top">` /
    `-row-positioner placement="left">` — prop `editor`; data attrs
    `data-state/data-side/data-align`; CSS var `--transform-origin`
  - `<…column-popup>` / `<…row-popup>` — data-state only
  - `<…column-menu-root>` / `<…row-menu-root>`
  - `<…column-menu-trigger>` / `<…row-menu-trigger>` — prop `editor`;
    renders our slot content (grip SVG inside)
- Register once via each `registerXxxElement()` (module-level flag). Props are
  property-only → assign `el.editor = proseKitEditor`.
- Menus: `<prosekit-menu-positioner>`, `<prosekit-menu-popup>`,
  `<prosekit-menu-item>`; items emit DOM `select` event
  (`MenuItemEvents { select }`) → `addEventListener("select", …)`.
- Docs model = copy-paste composition: menus/labels/wiring/canExec are ours.
- Drag interop pre-wired in repo: `table-block-view.ts` stopEvents passes
  `[data-role="col|row-drag-handle"]`; `editor-drag-drop.ts` ignores those
  drags; drag payload `application/x-prosekit-table-handle-drag`;
  `defineTableDropIndicator()` in `@prosekit/extensions/table`.

### Composition tree

```
<prosekit-table-handle-root>                      [editor]
├── <…drag-preview/>                              [editor]
├── <…drop-indicator/>                            [editor]
├── <…column-positioner placement="top">          [editor]
│   └── <…column-popup>
│       └── <…column-menu-root>
│           ├── <…column-menu-trigger> [editor] (grip-horizontal svg)
│           └── <prosekit-menu-positioner placement="bottom">
│               └── <prosekit-menu-popup class="th-menu">
│                   ├─ Insert Left   → addTableColumnBefore
│                   ├─ Insert Right  → addTableColumnAfter
│                   ├─ Clear Contents→ deleteCellSelection
│                   ├─ Delete Column → deleteTableColumn  (danger)
│                   └─ Delete Table  → deleteTable        (danger)
└── <…row-positioner placement="left">            [editor]
    └── …same shape… (Insert Above/Below → addTableRowAbove/Below,
        Delete Row → deleteTableRow, danger items same)
```

### Implementation steps

1. New file `src/plugins/table-handle-ui.ts`:
   - module-level `let registered = false` + register-all function;
   - `setupTableHandleUI(proseKitEditor): () => void` builds the tree above,
     sets `editor` props, wires `select` handlers to commands via
     `editor.exec(command)` / command actions from `@prosekit/core` actions
     (`editor.commands.addTableColumnBefore()` style is ProseKit API; fallback
     = PM `commands` from prosemirror-tables through `view.action`);
   - appends root into `view.dom.parentNode` (`#inb4doc-editor`, SlashView
     precedent); returns cleanup that disconnects listeners + removes nodes.
2. canExec refresh WITHOUT an emitter (none found on Editor): mount a tiny PM
   plugin view whose `update(view)` toggles each item's disabled state from
   `view.state` (`canExec` equivalents: check selection in cell / CellSelection
   presence). Same pattern as SlashView. Simplest wiring: create the plugin in
   editor-config's extensions array and pass a ref callback the UI registers
   itself with.
3. Wire into `createEditor()` (`src/config/editor-config.ts`):
   - extensions array: `...(isMobileDock() ? [] : [tableHandlePlugin])`
   - post-mount section (next to `initHugoRefClicks`):
     `if (!isMobileDock()) handleCleanup = setupTableHandleUI(prosekitEditor)`
   - store cleanup on EditorInstance.destroy().
4. CSS (Nord) ~60 lines in `src/styles/editor/editor.css`: grip buttons,
   `.th-menu` popup (bg/border/radius/shadow from foundation vars), danger
   color = `--color-error` (NOT --color-danger), hover states. Mind cascade:
   templates/styles/*.eta win ties at equal specificity — scope modifiers
   under parent classes. Positioners rely on floating-ui inline styles; don't
   override left/top.
5. Icons: grip SVGs — grep `src/eta/icons.ts` for available names
   (`grep -oE "^export const \w+" | grep -i grip`); if none suitable use two
   inline 16px SVGs (6-dot grid vertical/horizontal) defined locally.
6. Verify: tsc + full build (CSS changed) + Playwright smoke on port 32600
   (shadow-content harness): hover shows grips, menu actions mutate table,
   drag reorders row, save/reload intact per TABLE-PLAN.md corpus.

(Note: the old step about "dead stubs" `ToolbarCommand.RemoveRow/DeleteCol/
RemoveTable` is resolved — `editor-mutation-service.ts` already lazy-imports
`deleteRow/deleteColumn/deleteTable` from `prosemirror-tables` for those
commands; the desktop menus simply bypass them by exec'ing commands directly.)

### Risks / notes

- z-index vs `.book-layout` scroller: positioners use fixed/absolute +
  Popover API option (`hoist` default false). If clipped by scroll containers,
  set `hoist = true` on positioners.
- Dark mode: use theme vars only; test both.
- Keep bundle delta small: import from subpaths
  (`@prosekit/web/table-handle`, `@prosekit/web/menu`), not barrel.

## Phase 2 — Block handle swap (desktop, AFTER P1 lands + verified)

Delete the homegrown desktop `BlockHandleView` branch in
`src/features/block-edit.ts` and replace it with the native
`@prosekit/web/block-handle` element tree + `@prosekit/web/drop-indicator`.
Mobile keeps `BlockHandleView` entirely (existing `isMobileDock()` gate on
the factory map — flip the gate so desktop stops registering it).

Why worth it: hover-any-block visibility (vs empty-paragraph-start only),
built-in drag reorder of ANY block, deletes hand-rolled positioning code
(`#updatePosition`'s viewport-width heuristics, panel-rect math).

### Verified API facts (from installed `@prosekit/web/dist/block-handle.d.ts` / `.js`)

- Subpaths: `@prosekit/web/block-handle`, `@prosekit/web/drop-indicator`.
  Light-DOM aria-ui elements (no shadow DOM), property-only props.
- Composition tree:

```
<prosekit-block-handle-root>          [editor]  ← provides store ctx to descendants
└── <…positioner placement="left">    (NO editor prop — consumes root's ctx;
        placement defaults "left"; hoist opt-in; data-state/side/align,
        --transform-origin css var)
    └── <…popup>                       (data-state open/closed)
        ├── <…add>                     [editor]  ("+" button)
        └── <…draggable>               [editor]  (grip; data-dragging while dragging)

<prosekit-drop-indicator/>             [editor, width=2]  (landing line overlay)
```

- Register once: `registerBlockHandleRootElement`,
  `-PositionerElement`, `-PopupElement`, `-AddElement`, `-DraggableElement`,
  plus `registerDropIndicatorElement` (all module-level flags, same pattern
  as P1).
- Only `root`/`add`/`draggable` take the `editor` prop; `positioner`/`popup`
  get everything via the aria-ui context the root provides down the DOM tree.
- Visibility is built in: the root tracks the hovered/caret block and only
  opens when there is NO active text selection and NO scroll in progress.
  Hover-any-block for free — including headings, lists, quotes, tables.
- Root emits a DOM `stateChange` event (`BlockHandleStateChangeEvent`,
  detail `{ node, pos } | null`) whenever the hovered block changes — our hook
  for anchoring OUR add-block menu.
- Dragging: `draggable` sets a PM `NodeSelection` at the block pos on
  drag-start, then runs native HTML5 DnD. Pair with
  `<prosekit-drop-indicator>` to draw the landing line (replaces nothing we
  have today — prose blocks have no reorder UI).
- `+` behavior (the P2 must-solve, now answered): the add element binds its
  own target-phase `pointerdown` that calls
  `editor.exec(insertDefaultBlock({ pos: pos + node.nodeSize }))` — i.e. a
  bare paragraph below the hovered block. There is no prop/event to override
  it, BUT the binding is an ordinary listener on the element itself: a
  capture-phase `pointerdown` listener on our wrapper (ancestor) fires first.
  Intercept = `if (e.target.closest("prosekit-block-handle-add")) {
  e.preventDefault(); e.stopPropagation(); openOurAddMenu(); }` where
  `openOurAddMenu()` opens the shared `menuRegistry.get("add-block")` Menu
  (same registry the mobile FAB uses) anchored at the popup's rect, and on
  item select inserts at `stateChange.detail.pos + node.nodeSize` (reuse
  `executeInsertCommand` / `InsertBlockCommand` flow).

### Implementation steps

1. New file `src/plugins/block-handle-ui.ts` (mirror P1's structure; share the
   register-flag helper if P1 factored one out):
   - register-all for the five block-handle elements + drop indicator;
   - `setupBlockHandleUI(proseKitEditor): () => void` builds the tree, assigns
     `editor` props, appends into `view.dom.parentNode`, adds the
     capture-phase `pointerdown` interceptor on the wrapper, subscribes
     `stateChange` to remember `{ node, pos }`, returns cleanup.
2. Gate & delete: in `configureBlockEdit()` remove the desktop
   `blockViewFactories.set(...)` registration (keep mobile), or delete
   `BlockHandleView` outright if mobile moves to the quick-bar permanently —
   confirm with user before deleting the class.
3. Audit `editor-drag-drop.ts`: ensure drags whose target is inside
   `prosekit-block-handle-*` are ignored (extend the existing
   `[data-role="col|row-drag-handle"]` guard pattern) so image-upload DnD and
   the handle's NodeSelection drag never cross-fire.
4. CSS ~40 lines in `src/styles/editor/editor.css`: gutter offset/size of the
   positioner, grip button hover states, popup bg/border/shadow/radius from
   foundation vars, optional `--transform-origin` scale transition. Same
   cascade rules as P1 step 4; `hoist = true` if `.book-layout` clips.
5. Verify: tsc + full build + Playwright smoke on port 32600: hover any block
   type shows the handle, `+` opens OUR add-block menu (not a bare paragraph),
   selecting an item inserts that block below the hovered block, dragging a
   heading/list/code block drops it at the indicator line, save/reload intact.

## Phase 3 — Lingering Milkdown cleanup

No `@milkdown/*` packages remain in `package.json`, `bun.lock`, or
`node_modules` (Vue gone too) — deps are clean. Residual references:

### Broken selectors — FIXED 2026-08-23

- `e2e/session.ts` — default `waitFor` + `tableBox()` located
  `.milkdown-table-block`, a class that stopped existing at the migration.
  Now `.ProseMirror .tableWrapper` (what prosemirror-tables' `TableView`
  actually renders). Both existing callers pass explicit `waitFor`, so the
  default change is safe; README bullet updated to match.
- `e2e/dom-timeline.ts` — same dead selector in the default watch list,
  replaced with `.ProseMirror .tableWrapper`.

### Stale comments — FIXED 2026-08-23

All "Milkdown" comment references reworded for the ProseKit stack (verified
against installed deps where behavior was claimed):

- `toolbar-command.ts` / `slash-command.ts` — "Milkdown editor commands" →
  "editor commands".
- `plain-paste.ts` — "before the Milkdown clipboard plugin" → "before
  ProseKit's clipboard plugin".
- `dirty.ts` — dropped the "(it has the Milkdown `ctx`)" parenthetical.
- `keyboard.ts` — Delete-at-list-item-start comment re-attributed to
  prosemirror-flat-list's `deleteCommand` (verified: it binds
  `Delete: deleteCommand`, which lifts at list-item start); Tab comment now
  says "stock list keymap (prosemirror-flat-list)"; heading comment now cites
  ProseKit's `backspaceUnsetHeading` binding (verified in
  `@prosekit/extensions/heading`) and notes Delete has no such binding.
- `insert-command.ts` / `editor-source.ts` / `scroll-to-text.ts` — "no
  Milkdown imports" / "Milkdown ctx" phrasing dropped.
- `styles/layout/layout.css` header — "Milkdown content sizing" → "editor
  content sizing". (`list.css`/`link.css` headers keep their accurate
  historical "cleared Milkdown-era CSS" notes.)

### Naming / adapter leftovers — FIXED 2026-08-23

- `edit-toolbar-controller.ts` + `dock-controller.ts` — `milk` vars gone;
  both use `editor.view` directly; the pointless dynamic import of
  `editor-context-service` removed (positionPopover is synchronous now).
  `anchorFabMenu` keeps its `async` signature (callers sequence via
  `.then()`).
- `src/services/editor-context-service.ts` **deleted**: `getView`/
  `focusView` were trivial wrappers, `editorContext`'s PM-class getters had
  zero consumers, and `getMarkdown` moved next to `createMarkdownBridge` in
  `config/editor-markdown.ts`. Its only real consumer
  (`editor-controller.ts`) imports from there now.

## Status

- P1: approved, implementation not started (this file is the spec).
- P2: spec complete on native `@prosekit/web` bindings (incl. the `+`
  interception answer); blocked on P1 completion.
- P3: **DONE** 2026-08-23 — e2e selectors fixed, stale comments reworded,
  `milk` renames + `editor.view` inlining, `editor-context-service.ts`
  deleted. Verified with tsc + full build; zero "Milkdown" references left
  outside historical notes (`AGENTS.md`, cleared-CSS file headers).
