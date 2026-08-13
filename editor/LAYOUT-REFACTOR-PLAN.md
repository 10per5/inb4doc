# Layout Service Refactor Plan

Goal: replace the `{ nav, meta }` boolean layout state with a panel-based model
(`{ leftPanel, rightPanel }`), move fullview/center-screen criteria into
`LayoutService` instead of CSS-class sniffing, fix the tablet viewport so the
Meta panel opens in the left bar (replacing the nav column) instead of a
center-screen fullview, and add a keyboard-aware `MobileShrink` width that keeps
the fixed topbar/dock visible while the on-screen keyboard is open.

## 1. Int enums (DONE)

- `src/config/enums/layout.ts`:
  - `enum LayoutPreset { Focused, LeftPanel, RightPanel, TwoPanel }`
  - `enum LayoutWidth { Mobile, Tablet, Desktop, MobileShrink }`
- Exported from `src/config/enums/index.ts` (Types section).

## 2. LayoutService — panel-based state + criteria methods (DONE)

`src/services/layout-service.ts`:

- `LayoutState` → `{ leftPanel: boolean; rightPanel: boolean }`
  (rename `nav` → `leftPanel`, `meta` → `rightPanel`; update `bootDefaults`,
  `getPreset`, `apply`, and the `LayoutChangedPayload` fields).
- Public API: `isLeftPanelOn`/`setLeftPanel`/`toggleLeftPanel`;
  `isRightPanelOn`/`setRightPanel`/`toggleRightPanel`. (No aliases — all callers
  updated.)
- `getPreset()` maps directly from state (no derivation from two booleans).
- Criteria methods (the "signatures" stored in the layout service):
  - `getWidth(): LayoutWidth`
  - `isCenterScreen(type: ViewType): boolean` — a view renders as a center-screen
    fullview at the current width. `navigation` always; everything else only on
    `Mobile`/`MobileShrink` (meta is a left-bar panel on tablet, the aside column
    on desktop).
- Keyboard awareness: subscribes to `trackKeyboardOffset`. While the keyboard is
  open on a mobile viewport, `currentWidth()` resolves to `MobileShrink`
  instead of `Mobile`. `apply()` also publishes the overlay height as
  `--kb-offset` on `:root` (the shrink CSS consumes it) and toggles the
  `layout-mobile-shrink` body class.
- `apply()` toggles body classes (renamed to match the panel model — see §5):
  - `layout-leftpanel-off` (was `layout-nav-off`)
  - `layout-rightpanel-off` (was `layout-meta-off`)
  - `layout-focused` (was `layout-focus`)
  - `layout-mobile-shrink`
  - emit `LayoutChanged { preset, width, leftPanel, rightPanel }`

## 3. Consumers (DONE)

`src/services/view-controller.ts`:

- LayoutChanged handler: meta is only a center screen on mobile.
  `if (isMobileDock()) return; if (this.current === "meta") this.switchTo("editor");`
  (cleans up a stray meta fullview after a resize, and never opens the tablet
  fullview again).
- `setNav(false)` → `setLeftPanel(false)`.
- Keep `ensureMetaScreenView()` (still used by mobile).

`src/controllers/meta-panel/meta-panel-controller.ts`:

- Replace `if (this.element.classList.contains("fullview-view"))` with
  `if (LayoutService.getInstance().isCenterScreen("meta"))`.
- `setMeta(false)` → `setRightPanel(false)`.

`src/config/menu-definitions.ts` (View menu → Panels):

- `isNavOn`/`toggleNav` → `isLeftPanelOn`/`toggleLeftPanel` ("Navtree" label stays)
- `isMetaOn`/`toggleMeta` → `isRightPanelOn`/`toggleRightPanel` ("Meta panel" stays)

## 4. Tablet meta → left bar (CSS) (DONE)

Reuse the existing `#meta-panel-mount` (`.book-rightpanel`) instance — no new DOM.
The aside is already `display: none` below 1200px via `--aside-visibility: none`,
and its `meta-panel` Stimulus controller is connected regardless of visibility.

`lib/style/layout.css` (the structural asset that already owns the body-class
rules):

```css
@media (min-width: 768px) and (max-width: 1199px) {
  /* Meta on → the left column hosts the meta panel instead of the nav tree. */
  body:not(.layout-rightpanel-off) .book-leftpanel { display: none; }
  body:not(.layout-rightpanel-off) .book-rightpanel {
    display: flex;
    width: 260px;
    border-left: none;
    border-right: 1px solid var(--color-border);
    order: -1; /* pull to the left of .book-content */
  }
}
```

- `body:not(.layout-rightpanel-off)` = right panel is on (class is present only
  when off).
- Specificity beats the base `.book-rightpanel { display: var(--aside-visibility) }`
  and `.book-leftpanel` rules; gated to tablet so mobile/desktop are untouched.
- Desktop meta (aside right, 240px) and mobile meta (fullview via "more") are
  unchanged.
- The tablet-left aside keeps `.screen-header` (with its close affordance) since
  the panel is transient there.

## 5. CSS class names — renamed to the panel model (DONE)

Both the layout-model body classes and the structural column classes now use the
`leftpanel`/`rightpanel` naming instead of `nav`/`meta`/`menu`/`aside`:

| Old | New | Meaning |
|---|---|---|
| `layout-nav-off` | `layout-leftpanel-off` | left panel column hidden |
| `layout-meta-off` | `layout-rightpanel-off` | right panel column hidden |
| `layout-focus` | `layout-focused` | neither panel on |
| — | `layout-mobile-shrink` | keyboard open on mobile (width = MobileShrink) |
| `.book-menu` | `.book-leftpanel` | left column (nav tree host) |
| `.book-aside` | `.book-rightpanel` | right column (meta panel host) |
| `.book-menu-backdrop` | `.book-leftpanel-backdrop` | mobile drawer backdrop |

The structural `.book-leftpanel` / `.book-rightpanel` (with the shared `book-`
theme prefix used by `.book-layout` / `.book-content` / `.book-page`) are set in
`shell.eta` and consumed by `lib/style/layout.css`, the runtime layout CSS, the
print styles, `ui-store` (drawer), `block-edit` (prose anchoring) and
`mobile-dock.eta`. The layout service drives their visibility via the body
classes above; it never toggles the structural classes directly.

Not changing:

- `.fullview-view` styling and mobile fullview flows (navigation/more/prefs/
  images/changes/meta on mobile).
- Desktop layout structure.

## 6. MobileShrink layout — keyboard-aware mobile width (NEW)

Problem (Android): opening the on-screen keyboard pans the visual viewport to
keep the caret visible. The fixed topbar/dock anchor to the layout viewport, so
the pan carries them out of the visible area (topbar hides on scroll-down).

Fix: a `MobileShrink` width that reduces the layout height to the visible area
above the keyboard. With the scroll container sized to the visual viewport, the
editor content scrolls within it and the browser has nothing to pan.

- `LayoutWidth.MobileShrink` (enum, §1).
- `LayoutService` subscribes to `trackKeyboardOffset` (same util the dock uses
  for its FAB relocation). On a mobile viewport with the keyboard open,
  `currentWidth()` returns `MobileShrink`; `apply()` toggles
  `layout-mobile-shrink` and sets `--kb-offset` on `:root`.
- `templates/styles/mobile-dock.eta` (ships for GuiMobile + web builds, gated by
  `it.mobileDock`):

```css
body.layout-mobile-shrink #app,
body.layout-mobile-shrink .book-layout {
  height: calc(100vh - var(--kb-offset, 0px));
}
```

- `--kb-offset` = keyboard overlay height (`window.innerHeight - visual viewport
  height`), already measured by `trackKeyboardOffset`. The fallback `0px` keeps
  the calc valid before the first measurement.
- `isCenterScreen()` treats `MobileShrink` as mobile, so fullviews and the
  drawer keep working while typing.
- The dock bar itself stays at the layout viewport bottom (behind the keys);
  the FAB already relocates above the keyboard via `#dock.kb-open`.
- Alternative considered: `interactive-widget=resizes-content` viewport meta
  (native layout-viewport resize). Not adopted — the layout-driven approach
  works across the native WebView and browsers without touching the meta tag.

## 7. Verification

- `bun --bun tsc --noEmit` after the changes.
- No Playwright runs unless the user asks.

## Files touched

- `src/config/enums/layout.ts` (MobileShrink added)
- `src/config/enums/index.ts`
- `src/services/layout-service.ts` (panel state, criteria, keyboard awareness)
- `src/services/view-controller.ts`
- `src/controllers/meta-panel/meta-panel-controller.ts`
- `src/config/menu-definitions.ts`
- `lib/style/layout.css` (renamed body classes, tablet-left meta)
- `templates/styles/mobile-dock.eta` (MobileShrink shrink rules)
