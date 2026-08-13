# Plan — Topbar formatting additions + tablet quick bar

## Decisions (confirmed with user)

1. **Topbar additions** (Desktop + Tablet only, never mobile):
   undo/redo, inline code (already a button, needs active state), quote,
   bullet/ordered/task list buttons with active states, and a checked toggle.
   The checked toggle applies to the **current item** under the caret (an
   earlier plan had a whole-block flip — superseded by Part 8).
2. **Undo/redo placement**: topbar on desktop (≥1200px) only. Mobile/tablet get
   undo/redo from the quick bar (edit-toolbar). On tablet the topbar must NOT
   show its own undo/redo (no duplication with the quick bar).
3. **Tablet (768–1199px)**: show the edit-toolbar quick bar ONLY — the dock nav
   row (Files/FAB/More) stays hidden. The quick bar is a plain fixed bottom
   strip: it does NOT follow the cursor, no follow-mode popover.
4. Desktop ≥1200px: quick bar stays fully hidden (unchanged); undo/redo live in
   the topbar.

## Relevant files

- `templates/views/controller/topbar.eta` — topbar markup (desktop/tablet center
  section is the `!mobileDock` branch)
- `src/controllers/topbar-controller.ts` — renders topbar, owns active states
- `src/features/toolbar-handler.ts` — `ToolbarCommandExec` dispatcher
- `src/services/command-service.ts` — Milkdown command getters
- `src/config/enums/toolbar-command.ts` — `ToolbarCommand` int enum
- `src/config/enums/block-context.ts` — `ActiveBlockType` enum
- `src/plugins/block-context.ts` — block detection for the caret
- `src/controllers/edit-toolbar-controller.ts` — quick bar controller
- `templates/styles/mobile-dock.eta` — dock/quick-bar CSS (compiled last)
- `src/styles/app/toolbar.css` — topbar button CSS
- `src/utils/mobile.ts` — `isMobileViewport()` (= `max-width: 767px`)

---

## Part 1 — New commands

### 1a. `src/config/enums/toolbar-command.ts`

Append two values (current max is `Redo = 20`):

```ts
Blockquote,        // 21 (tc-21) — toggle blockquote around the current block
ToggleTaskChecked, // 22 (tc-22) — toggle checked on the CURRENT list item
```

### 1b. `src/services/command-service.ts`

Add a getter mirroring the existing `wrapInBulletListCommand` (line 72):

```ts
get wrapInBlockquoteCommand(): $Command<unknown> {
  return this._cm!.wrapInBlockquoteCommand
}
```

(`wrapInBlockquoteCommand` is already imported/available via the commonmark
preset — `src/features/insert-command.ts:20` uses it for `SlashCommand.Blockquote`.)

### 1c. `src/config/enums/block-context.ts`

Add `Blockquote = 5` to `ActiveBlockType`.

### 1d. `src/plugins/block-context.ts`

In `getActiveBlockContext`, detect the `blockquote` ancestor. Match on
`node.type.name === "blockquote"` after the `table` check and before the
`list_item` check (deepest match wins, consistent with table-in-list behavior;
a list nested inside a blockquote reports as list, not quote):

```ts
if (node.type.name === "blockquote") {
  return { type: ActiveBlockType.Blockquote, checked: null, canSink: false }
}
```

### 1e. `src/features/toolbar-handler.ts`

- Add `case ToolbarCommand.Blockquote: commands.call(commandService.wrapInBlockquoteCommand.key); break`
- Add a block-level checked toggle helper next to `setTaskChecked` (line 18):

```ts
// Toggle `checked` for the WHOLE list block containing the caret:
// all items checked → uncheck all; otherwise check all.
function toggleTaskChecked(view: EditorView): void {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name !== "bullet_list" && node.type.name !== "ordered_list") continue
    const items = node.childCount
    const allChecked = node.content.size > 0 &&
      Array.from({ length: node.childCount }).every((_, i) =>
        node.child(i).attrs.checked === true,
      )
    const target = !allChecked
    const tr = view.state.tr
    node.forEach((child, offset) => {
      if (child.attrs.checked !== target) {
        tr.setNodeMarkup($from.before(d) + 1 + offset, undefined, {
          ...child.attrs,
          checked: target,
        })
      }
    })
    if (tr.docChanged) view.dispatch(tr.scrollIntoView())
    return
  }
}
```

  Wire it: `case ToolbarCommand.ToggleTaskChecked: toggleTaskChecked(view); break`

  (Superseded: Part 8 replaced the block-wide flip above with a per-item
  `toggleTaskChecked` and removed the whole-block walk.)

---

## Part 2 — Topbar (desktop + tablet)

### 2a. `templates/views/controller/topbar.eta` — `!mobileDock` sections

**Undo/redo go in the LEFT section, after the View menu** (beginning of the
topbar, before the Bold formatting group in the center). Current left section
(`!mobileDock` branch): `File | View`. New order:

```
File | View | [undo] [redo] || heading sep bold italic strike code hr [quote]
sep [list-dropdown] sep link sep source
```

- Undo/redo: class `toolbar-history-btn`, `data-cmd="tc-19"` / `tc-20`,
  icons `it.icons.undo` / `it.icons.redo`, `title="Undo"` / `"Redo"`, `disabled`.
- Quote: `data-cmd="tc-21"`, icon `it.icons.quote`, `title="Quote"`.

**List types live in a dropdown mirroring the header dropdown** (not four
separate buttons). New markup in the center section, after the quote button:

```html
<span class="toolbar-list-wrap">
  <button class="btn btn-icon toolbar-list-btn"
    data-action="click->topbar#toggleListDropdown" title="List" aria-haspopup="true">
    <span class="list-label"><%~ it.icons.list %></span>
  </button>
  <div class="toolbar-list-dropdown">
    <button data-action="click->topbar#execList" data-kind="bullet">Bullet list</button>
    <button data-action="click->topbar#execList" data-kind="ordered">Ordered list</button>
    <button data-action="click->topbar#execList" data-kind="task">Task list</button>
    <button data-action="click->topbar#execList" data-kind="checked" disabled>Check/uncheck</button>
  </div>
</span>
```

- The trigger's `list-label` icon reflects the current list kind (bullet /
  ordered / task), and the trigger gets `.active` while the caret is in any list.
- Dropdown items highlight (`.active`) the current kind; the "Check/uncheck"
  item is disabled unless the caret is in a task list.
- `data-kind` → `ToolbarCommand`: `bullet`→`BulletList` (tc-11),
  `ordered`→`OrderedList` (tc-13), `task`→`TaskList` (tc-12),
  `checked`→`ToggleTaskChecked` (tc-22).

All icons verified present in `src/eta/icons.ts`: `undo`, `redo`, `quote`,
`list`, `numberedListLeft`, `checkSquare`, `square`.

### 2b. `src/controllers/topbar-controller.ts` + `src/config/enums/toolbar-action.ts`

- `toolbar-action.ts`: append `ToggleListDropdown` and `ExecList` to the
  `ToolbarAction` enum + `toolbarActions` map (`toggleListDropdown` /
  `execList`).
- `updateTextState`: add `this.setCommandActive(ToolbarCommand.Code, state.code)`
  (button already exists at tc-3; only the active wiring is missing).
- New subscription `AppEvent.BlockContextChanged` → `updateBlockState(context)`:
  - tc-21 (quote) active when `context.type === ActiveBlockType.Blockquote`
  - `.toolbar-list-btn` active when in any list (BulletList / OrderedList /
    TaskList); `list-label` icon swaps to the current kind (`list` /
    `numberedListLeft` / `checkSquare`)
  - dropdown items: `.active` on the matching `data-kind` (`bullet` / `ordered`
    / `task`); the `data-kind="checked"` item `disabled` unless
    `context.type === TaskList` (also `.active` when `context.checked === true`)
- New subscription `AppEvent.HistoryChanged` → disable tc-19 when `!canUndo`,
  tc-20 when `!canRedo` (`disabled` attr + `.is-disabled` class, mirroring
  `EditToolbarController.setDisabled`).
- New actions `toggleListDropdown()` (mirror `toggleHeadingDropdown`; closing one
  dropdown closes the other, plus `.toolbar-menu.open`) and `execList(e)` (read
  `data-kind`, map to ToolbarCommand, emit `ToolbarCommandExec`, close dropdown).
- `onDocClick` outside-click close extended to the list dropdown.
- `getAllFocusable` / `getAllTriggers` exclusion extended to the list dropdown.
- Reset on `SourceModeToggled` and non-editor `ViewChanged`: also reset the
  block state to `EMPTY_BLOCK_CONTEXT` (clear quote/list active + disabled).
- Import `ActiveBlockType` / `EMPTY_BLOCK_CONTEXT` from `@/config/enums/block-context`.

### 2c. `src/styles/app/toolbar.css` + `src/styles/ui/body-toolbar.css`

- toolbar.css: add `.btn-icon:disabled` style (grayed, `cursor: default`) —
  topbar undo/redo start disabled.
- toolbar.css: hide undo/redo on tablet (768–1199px) so the topbar never
  duplicates the quick bar at that width:

```css
@media (min-width: 768px) and (max-width: 1199px) {
  .app-toolbar .toolbar-history-btn {
    display: none;
  }
}
```

- body-toolbar.css: add `.toolbar-list-wrap` / `.toolbar-list-btn` /
  `.toolbar-list-dropdown` styles mirroring the heading dropdown (`.open`,
  item `:hover`, item `.active`, `.is-disabled`/`:disabled`), with a wider
  min-width for the labeled items.

---

## Part 3 — Tablet quick bar (768–1199px)

### 3a. `templates/styles/mobile-dock.eta`

Inside the existing `it.mobileDock` / `it.webAdaptive` block, append a tablet
override AFTER the `.desktop-layout` hide rules (line 8–11) so it wins the
equal-specificity cascade:

```css
/* Tablet: show the quick bar only — the dock nav row stays hidden and the
 * strip becomes a plain fixed bottom bar (no follow mode on tablet). */
@media (min-width: 768px) and (max-width: 1199px) {
  .desktop-layout #dock { display: block; }
  .desktop-layout #dock .dock { display: none; }
  .desktop-layout #edit-toolbar { display: block; }
  .desktop-layout .book-layout { padding-bottom: calc(47px + env(safe-area-inset-bottom, 0)); }
}
```

Rationale / caveats:
- `#edit-toolbar` is a block child of fixed `#dock` (shell.eta:50), so showing
  `#dock` while hiding its `.dock` nav row (dock.eta) leaves just the strip at
  the bottom edge, above `#dock`'s safe-area padding.
- The base `.book-layout` clearance is `calc(104px + env(...))` (line 117, via
  `:has`) for bar + strip; on tablet the nav row is hidden so we tighten it to
  the strip height (~47px = 34px buttons + 12px padding + 1px border) with a
  `.desktop-layout .book-layout` rule. If the `:has` variant out-specifies it,
  accept the extra bottom padding (cosmetic only) — or scope the tablet rule as
  `.desktop-layout .book-layout:has(#edit-toolbar:not([hidden]))` to match.
- gui-desktop skips this whole file (`mobileDock` off); gui-mobile skips the
  `webAdaptive` block. Only web builds render tablet CSS. Native app desktop
  windows are unaffected.

### 3b. `src/controllers/edit-toolbar-controller.ts`

Gate follow mode to mobile viewport only, so tablet keeps a docked strip:

```ts
import { trackKeyboardOffset, isMobileViewport } from "@/utils/mobile"
// in trackKeyboardOffset callback:
this.followMode = offset > 0 && isMobileViewport()
```

No other controller change needed: `updateVisibility()` still hides outside the
editor view, and desktop ≥1200px is already hidden by `.desktop-layout #edit-toolbar`.

---

## Part 4 — Tablet quick bar bug (WebLocal) — DONE

### Root cause

`src/controllers/core.ts` registered the dock controllers (`dock`, `more`,
`edit-toolbar`) only when runtime `isMobileDock()` was true (gui-mobile or
viewport ≤ 767px). But the `#dock` / `#edit-toolbar` markup ships for every
`MobileDock` build at ANY viewport (shell.eta guards on build-time
`hasFlag(AppFunc.MobileDock)`, lib/build.ts:101). So at tablet width (768–1199px)
the element existed and the compiled tablet CSS showed it, but no controller
ever connected → the strip stayed empty/inert.

### Fix

`core.ts`: register the dock controllers whenever the dock markup ships —
gate on `hasFunc(AppFunc.MobileDock)` instead of `isMobileDock()`. The runtime
viewport still decides the ACTIVE layout inside the controllers (mobile topbar
render, follow mode, dock nav vs quick bar). The modules were already statically
imported into core.ts, so the eager boot set is unchanged.

---

## Part 5 — Procedural topbar overflow ("…" dropdown) — DONE

### Requirement (user, verbatim intent)

Toolbar gets too long on zoomed-in viewports. It should be smart and move the
buttons that would overflow into a "…" dropdown. It must be **procedural**
(runtime measurement, not media queries), and it must **reserve space for the
unsaved-changes (Dirty diff size) portion** of the topbar so the dirty counter
never gets pushed out.

### Design

- Desktop/tablet topbar only (`!isMobileDock()` render) — the mobile topbar has
  its own slim fixed layout and no procedural overflow.
- A `…` trigger (`.toolbar-overflow-btn`, icon `moreHoriz`) + `.toolbar-overflow-dropdown`
  live at the END of the center section.
- `TopbarController.relayout()` runs on a `ResizeObserver` on the toolbar AND on
  every width-affecting event (DirtyChanged, TextStateChanged, BlockContextChanged,
  SourceModeToggled, ViewChanged):
  1. Un-hide all center items (restore natural widths) before measuring.
  2. `room = toolbarInner − left − sep − toolbarGaps − rightFixed − dirtyReserve − triggerWidth`.
  3. Walk center items prefix-fit; overflow the suffix (`hidden`).
  4. Clone overflowed **simple command buttons** into the dropdown (clones keep
     `data-cmd`/`data-action` so Stimulus dispatches the same commands); the
     heading/list wraps and separators are hidden but not cloned (their dropdowns
     must stay anchored in the visible toolbar).
  5. Show the trigger only when something overflowed.
- **Reserved space (never allowed to overflow):**
  - the right section's always-visible controls (flush + prefs),
  - the dirty counter: **measured live** from its last-rendered "X pending +Y B"
    content (kept in the DOM while hidden) via `measureHiddenWidth()`, plus its
    margin-right and the flex gap to the flush button — so the reservation
    tracks the actual content at whatever viewport/zoom the toolbar renders in,
    and survives the counter hiding (no first-appearance shift),
  - the `…` trigger's own width, reserved while hidden too — showing it on
    overflow costs nothing and never shifts the layout.
- `.app-toolbar.toolbar-desktop .toolbar-section { flex-shrink: 0 }` — sections
  never squish; overflow is handled by hiding items. The class is toggled at
  runtime in `connect()` (`!isMobileDock()`), so the mobile topbar is unaffected.
- Dropdown closes on outside click (`onDocClick`), on command exec, and on
  `getAllFocusable` (QuickNav) it is excluded.
- Icons: `moreHoriz` verified in `src/eta/icons.ts`.

### Files touched

- `src/config/enums/toolbar-action.ts` — `ToggleOverflowDropdown` action
- `templates/views/controller/topbar.eta` — overflow wrap in the center section
- `src/controllers/topbar-controller.ts` — targets, ResizeObserver, `relayout()`,
  `renderOverflowItems()`, `measureHiddenWidth()` (handles both `hidden` attr and
  inline `display:none`), `toggleOverflowDropdown()`, `closeOverflowDropdown()`,
  `toolbar-desktop` class
- `src/styles/ui/body-toolbar.css` — overflow wrap/btn/dropdown + `flex-shrink: 0`

---

## Part 6 — Contextual task-list dropdown item — DONE

User: "Task List + Check/uncheck redundant, should be Task List (when another
kind of list) Then Checked Task List or Unchecked Task List to switch the
current block."

- The list dropdown has **three** items, not four.
- The third slot (`.toolbar-list-task`) is contextual:
  - block is NOT a task list → `data-kind="task"`, label "Task list" (converts
    the current block to a task list),
  - block IS a task list → `data-kind="checked"`, label "Checked Task List" when
    the caret item is unchecked, "Unchecked Task List" when it is checked —
    clicking toggles the CURRENT item only (see Part 8; the block-wide
    `allChecked` version was dropped).
- `ActiveBlockContext` carries `checked: boolean | null` (the caret item's own
  state, from `src/plugins/block-context.ts`), which drives the label and the
  `.active` state of the checked slot.
- `src/styles/ui/body-toolbar.css`: `.toolbar-list-dropdown` min-width 140 → 170px
  for the longer labels.

---

## Part 7 — Shared list dropdown (mobile reuses the desktop API) — DONE

User: "keep the current spec/design but deduplicate the logic", then: "mobile
still uses format-more with … for its overflow/lists … use the same api and
force the bullet point dropdown + hr to be in it on mobile view; mobile doesnt
use the bullet point dropdown but hard codes the 3 lists."

- **Before:** the mobile topbar's "…" was the flat `format-more` Menu with the 3
  lists hard-coded as `emitToolbarCommand(...)` lambdas; the desktop used the
  `.toolbar-list-wrap` dropdown (`data-kind` → `execList`).
- **Now:** the mobile topbar renders the SAME list dropdown as desktop —
  bullet / ordered / contextual `.toolbar-list-task` (Task list ↔ Checked/
  Unchecked Task List) — plus a 4th "Horizontal rule" item in the same dropdown
  (`data-cmd` → `execCommand`, the desktop's inline hr command). Both modes run
  the identical `toggleListDropdown` / `execList` / `updateBlockState` plumbing.
- `format-more` is **removed**: its registration, the `listCommandItem` helper,
  `emitToolbarCommand`, and the `isMore` special-case in `createMenus` are all
  deleted (the dock FAB never used it — it mounts `add-block`).
- `src/config/list-kinds.ts` (`ListKind` + `LIST_KIND_COMMANDS`) is the single
  kind→command source consumed by `execList` for both topbars.
- `execCommand` now closes the list dropdown when a `data-cmd` button inside it
  fires (the hr item).
- CSS: `.toolbar-dropdown-hr` top-border separator in `body-toolbar.css`; the
  mobile topbar's dropdown right-aligns (`.mobile-layout` + dock branches in
  `mobile-dock.eta`) since it sits near the slim bar's right edge.

---

## Part 8 — Per-item checked toggle + "Clear List Item" — DONE

User: "Topbar checked/unchecked list should only change the current one. It
should have a Clear List Item below it which turns the selected blocks into
non-lists if all are lists (it should only show when selected blocks are
lists)" — then "or if current cursor block is a list."

- The checked/unchecked action is now **per-item**: `toggleTaskChecked` in
  `src/features/toolbar-handler.ts` flips `checked` on the single `list_item`
  under the caret (the block-wide flip is gone). `ActiveBlockContext` drops
  `allChecked`; `src/plugins/block-context.ts` no longer walks the parent list
  and every construction site returns `{ type, checked, canSink }`.
- The dropdown gains a **Clear List Item** entry (`toolbar-list-clear`), shown
  only when the caret block (or any selected block) is a bullet/ordered/task
  list — `updateBlockState` toggles its `hidden` from `inList`. It fires
  `ToolbarCommand.ExitList` via the same `data-cmd` → `execCommand` path as the
  hr item, in BOTH topbar branches (desktop center dropdown + mobile dropdown,
  between the task slot and the hr item).
- New `clearListItems(view)`: unwraps every list touched by the selection back
  into plain blocks — covered items' content (paragraph + nested blocks)
  replaces the items, while the uncovered before/after items stay in their own
  same-kind lists (mirrors `setListItemKind`'s coverage rules). The caret lands
  at the start of the first unwrapped paragraph.
- `src/config/enums/toolbar-command.ts` gains `ToolbarCommand.ExitList`;
  `execCommand` needs no new case (it already falls through to
  `toolbar-handler` via `TOOLBAR_CMD_PREFIX`).
- CSS: `.toolbar-list-clear` shares the hr's top-border separator, and
  `.toolbar-list-dropdown button[hidden] { display: none }` (the dropdown
  buttons' `display: flex` would otherwise override the UA `[hidden]`).

---

## Verification

1. `bun --bun tsc --noEmit` (code changes).
2. `bun lib/build.ts` (Eta + CSS changed). Do NOT run build while `bun dev`
   is running (manifest clobbering — see AGENTS.md).
3. Manual/Playwright spot-checks (only if the user asks — do not run E2E by
   default):
   - Desktop ≥1200: undo/redo + quote/lists active states in topbar; no quick bar.
   - Tablet 768–1199: topbar shows quote/lists (no undo/redo); bottom strip with
     undo/redo + contextual list/table buttons; no cursor-follow when keyboard opens.
   - Mobile <768: unchanged (dock + follow mode; new buttons not in topbar).
