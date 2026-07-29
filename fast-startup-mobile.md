# Fast Startup for gui-mobile

## Problem

Android startup takes 1-3 seconds. The entire app waits for `app.js` (~1.3MB) to
download, parse, and execute before anything renders. The loading overlay is the
only visible element during this time.

## Architecture decision

**Features own their event subscriptions.** The controller is thin wiring only.
Features receive a narrow interface/getter for what they need — they never import
`editorContext` or `commandService` directly. ProseMirror types are allowed as
`import type` (zero bundle cost).

```
topbar-controller          → emits ToolbarCommandExec event
toolbar-handler (feature)  → subscribes, receives editor getter, dispatches commands
scroll-to-text (feature)   → pure DOM utilities, controller handles ProseMirror
editor-source (feature)    → DOM toggling, receives callbacks for Milkdown ops
link-dialog (feature)      → takes Editor, imports editorContext (needed for marks)
editor-controller          → thin wiring: connects features, owns Milkdown lifecycle
```

Only `editor-controller.ts` and `services/editor-context.ts` import `editorContext`.
Features are testable without mocking Milkdown — pass a mock getter/interface.

## Current status

**Phase 1 + Phase 2 complete. ~1.5s faster on Android.** `editor-config.ts` dynamic import
+ `editor-context.ts` / `command-service.ts` lazy-load services + event bus
decoupling are working. TSC passes cleanly.

### Phase 1 — Lazy-load Milkdown via services (DONE)

| File | Change | Status |
|------|--------|--------|
| `lib/build/build-mode.ts` | `FastStartup = 1 << 3` flag, enabled for `GuiMobile` | Done |
| `src/services/editor-context.ts` | **NEW** — singleton, lazy-loads `@milkdown/kit/core`, `@milkdown/core`, `@milkdown/kit/prose/state`. Exports context keys, ProseMirror constructors, convenience wrappers (`getView`, `getMarkdown`, `focusView`) | Done |
| `src/services/command-service.ts` | **NEW** — singleton, lazy-loads `@milkdown/kit/preset/commonmark`, `@milkdown/kit/preset/gfm`. Exports command objects as `$Command<T>` | Done |

### Phase 2 — Decouple UI from Milkdown (DONE)

| File | Change | Status |
|------|--------|--------|
| `src/stores/app-events.ts` | `ToolbarCommandExec` event + payload | Done |
| `src/controllers/topbar-controller.ts` | Emits `ToolbarCommandExec` events, no Milkdown imports, no `getEditor` | Done |
| `src/controllers/shell_controller.ts` | Removed `wireTopbar()` | Done |
| `src/features/toolbar-handler.ts` | **NEW** — subscribes to `ToolbarCommandExec`, dynamically imports services, dispatches commands | Done |
| `src/features/search/scroll-to-text.ts` | Pure DOM: `findTextMatch()`, `flashHighlight()`, `centerOnRect()` | Done |
| `src/components/dialogs/link-dialog.ts` | Takes `Editor` directly (not getter) | Done |
| `src/features/editor-source.ts` | Pure DOM toggling, receives callbacks | Done |
| `src/controllers/editor-controller.ts` | Thin wiring: `connect()` calls `initToolbarHandler(getter)`, no `commandService`/`openLinkDialog` imports | Done |
| `src/bridge/find.ts` | Uses `editorController.scrollToText()` instead of direct import | Done |

### Remaining Phase 2 work

| Task | Status |
|------|--------|
| Extract `execToolbarCommand` into `features/toolbar-handler.ts` | Done |
| `getCurrentContent()` / `updateEditorContent()` — kept in editor-controller (Milkdown owner) | Done |
| Verify tsc | Done |
| Verify bundle splitting | Not yet done |
| Update plan | Done |

### Known type: `$Command<T>`

- `CmdTuple` does not exist in `@milkdown/kit/core` — use `$Command<T>` from `@milkdown/utils`
- `.key` on commands is populated at runtime by plugin install, not at module load
- Access `.key` inside `editor.action()` callbacks only (editor fully initialized)

### Bundle impact (estimated)

Before Phase 1:

| Chunk | Size | Contents | Load timing |
|-------|------|----------|-------------|
| `app.js` | 181KB | Stimulus, controllers | Eager |
| shared chunk | 515KB | ProseMirror, Milkdown core, CommonMark, Vue | **Eager** |
| `editor-config` | 553KB | Editor plugins, katex, slash, block-edit | Lazy |

After Phase 1+2 — the shared 515KB chunk should no longer be eagerly loaded because:
- `editor-controller.ts` no longer statically imports Milkdown modules
- `topbar-controller.ts` has zero Milkdown imports
- `editor-source.ts`, `scroll-to-text.ts`, `link-dialog.ts` — no static Milkdown
- All Milkdown deps flow through `editorContext` / `commandService` singletons
- Services are tiny (~90-130 lines) with only `import type` at module level

**Need to verify with `bun build src/app.ts --outdir /tmp/verify --minify --splitting`.**

## Consumers of `editorContext` after Phase 2

| File | Imports `editorContext`? | Notes |
|------|--------------------------|-------|
| `editor-controller.ts` | Yes (static) | Milkdown lifecycle owner — acceptable |
| `toolbar-handler.ts` | Yes (dynamic only) | `await import()` inside handler body, zero static deps |
| `scroll-to-text.ts` | No | Pure DOM utilities |
| `editor-source.ts` | No | Pure DOM, receives callbacks |
| `link-dialog.ts` | Yes (static) | Needs `editorViewCtx` + `TextSelection` for mark toggling |
| `topbar-controller.ts` | No | Emits events only |

**`link-dialog.ts` is the exception** — it deeply needs ProseMirror for mark
toggling. Could be refactored to receive a `toggleLink(url)` callback from the
controller in a future pass.

## Phase 3 — Two-stage entry point (future)

Split `app.ts` into a **loader** (tiny, shows sidebar immediately) and **full app**.

Key changes:
- `src/controllers/core.ts` — shell + topbar + sidebar
- `src/controllers/index.ts` — re-exports core + all remaining controllers
- `src/app.ts` — branches on `FastStartup`: register core first, hide overlay, load rest
- `templates/shell.eta` — conditional CSS (`loader.css` vs `app.css`)
- `src/styles/loader.ts` — minimal CSS entry point
- `src/controllers/shell_controller.ts` — split `initializeApp` into two phases

## Verification

1. `bun --bun tsc --noEmit` — type check (**passes**)
2. `bun build src/app.ts --outdir /tmp/verify --minify --splitting` — confirm lazy chunks (not yet verified)
3. `bun build.ts` — full build
4. Android build: sidebar renders before editor, overlay hides early

## What stays unchanged

- `templates/shell.eta` — no inline JS
- Web and desktop builds — zero behavioral changes (else branch)
- `build.ts` — `--splitting` already enabled
- Event bus pattern — no reactive abstractions
- `block-edit.ts` — stays in lazy `editor-config` chunk (already deferred)

## Deferred work (future phases)

- **Phase 3:** Two-stage entry point (loader + full app)
- **Phase 4:** Lazy-load heavy plugins per use (math, video, code-block-ui)
- **Phase 5:** Skeleton UI with incremental hydration
