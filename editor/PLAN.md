# inb4doc — Backlog Plan (6 items)

Scope: editor (web) + gui (desktop) + release/CI. Each item lists the problem,
the concrete approach, the files involved, and verification. Big architectural
items (2, 4) are designed here but should be confirmed before build.

---

## 1. Block handle overlaps the left explorer menu at browser zoom (web)

**Problem.** `BlockHandleView.#updatePosition()` in
`editor/src/features/block-edit.ts` (lines 142–168) computes its horizontal
position from the side-panel width buckets (`w >= 1350`, `800 <= w < 1350`,
`< 800`). At 133% browser zoom the CSS viewport shrinks (e.g. 1280 → ~962), the
handle is placed by the `800–1350` branch using `panelRight + 4.25rem`, and it
drifts over the left explorer (`.book-leftpanel`). It only looks right at 100%.

**Approach.** Make the handle position in the _actual available gutter_ rather
than a fixed panel-edge offset, mirroring how the slash/quick menu
(`SlashView`/`#positionMenu` in the same file) anchors to the real block rect:

- Compute the left explorer's right edge (`book-leftpanel` rect) and the editor
  prose area's left edge at _position_ time (they already query these elements).
- Place the handle at `max(explorerRight + gutter, proseLeft - handleWidth - gutter)`
  so it always sits in the gap and never overlaps the explorer.
- If the available gutter is too small (narrow zoom / mobile), fall back to the
  existing right-side placement (`domRect.right + rem`), i.e. the quick-menu-like
  behavior the user described — "use quick menu when it'd overlap".
- Keep using `view.coordsAtPos`/container-relative math (already done) plus the
  panel rects; no new globals (AGENTS.md: only `keyboard.ts` binds window events).

**Files.** `editor/src/features/block-edit.ts` (`BlockHandleView.#updatePosition`),
plus CSS in `lib/style/*` if a modifier class is needed.

**Verify.** `bun --bun tsc --noEmit`; manual: load at 100% and 133% zoom, confirm
handle never overlaps the explorer and still appears left of the text when there's
room. (Per AGENTS.md, no Playwright unless asked.)

---

## 2. Release flow: `/experimental` pref + CI builds 6 separate assets

**Problem.** Today releases are produced by pushing dev branches into `release/main`.
You want a single mainline + a user-facing `/experimental` preference, and a CI
pipeline that builds 6 separate asset variants instead of a branch-merge dance.

**Approach.**

- **`/experimental` pref:** add `experimental: boolean` to `WikiPrefs`
  (`editor/src/services/storage-service.ts`) + `preferences-store.ts`
  (DEFAULTS, getter/setter, `prefs` projection, `setExperimental`). Surface it in
  the prefs dialog (`editor/src/controllers/prefs-controller.ts` + the prefs Eta
  templates under `src/eta/views/`) as a toggle. Gate experimental UI/behavior on
  `prefsStore.experimental` (mirror how `hideEmptyFolders` is wired).
- **6 assets via CI:** add `.github/workflows/build.yml` that matrix-builds the
  existing `predep` stages into 6 artifacts. Proposed matrix (confirm with you):
  1. editor `web-remote` 2. editor `web-local` 3. gui `desktop-linux`
  2. gui `desktop-windows` 5. gui `desktop-macos` 6. gui `mobile` (apk).
     Build mode is already selected via `document.documentElement.dataset.buildMode`
     (`editor/lib/build/build-mode.ts`); the workflow just sets the per-mode build
     and uploads the 6 artifacts. No dev→release-main merges needed.
- Keep `predep package` for local/installer assembly; CI replaces the _publish_
  path.

**Open question for you:** confirm the exact 6-variant matrix (platform × channel
vs mode × channel) and whether `experimental` should also swap the asset
**channel** the updater fetches.

**Files.** `editor/src/services/storage-service.ts`, `preferences-store.ts`,
`prefs-controller.ts`, Eta prefs templates, new `.github/workflows/build.yml`,
root `predep.toml` (maybe add a `release` stage group).

**Verify.** `bun --bun tsc --noEmit`; `bun lib/build.ts` for each mode flag;
CI workflow dry-run if a runner is available.

---

## 3. CLI-opened dir should appear in Recent Files (GUI)

**Problem.** `recentProjectsStore.add(targetPath)` is only called in the in-app
"open project" path — `navigation-service.ts:220` (folder picker → `provider.setRoot`).
A directory opened via the GUI CLI (`inb4doc-gui /some/dir`, parsed in
`gui/src/args.cpp` as `content_root`) never records itself, so it's missing from
Recent Projects.

**Approach.**

- Identify the boot content-root on the editor side. The GUI passes it through the
  native bridge: `getInitialState()` (`editor/src/bridge/native.ts:77`) and/or the
  mount/SAF providers' initial root (`mount-provider.ts:68`, `saf-provider.ts:136`).
- After the provider root is established at boot (in
  `editor/src/controllers/shell_controller.ts` around the `getInitialState()` call
  at line 108, or right after `provider.setRoot` during boot), call
  `recentProjectsStore.add(rootDir)` so CLI/GUI-launched dirs show up.
- Guard with `hasFunc(AppFunc.ProjectPicker)` (GuiDesktop | GuiMobile) so web modes
  (server-owned root) don't pollute the list.

**Files.** `editor/src/controllers/shell_controller.ts`,
`editor/src/services/navigation-service.ts`, `recent-projects-store.ts`
(already capped at 10 — see item 5).

**Verify.** `bun --bun tsc --noEmit`; launch GUI with a dir arg, open Recent
Projects menu (`menu-definitions.ts:38`), confirm the dir is listed.

---

## 4. Security hardening: GUI↔App comm + supply-chain resilience

**Problem.**

- No auth token on the GUI↔App bridge (`window.saucer.exposed.*`, wired in
  `editor/src/bridge/*` and `gui/src/bridge.cpp`). If a malicious page is loaded
  in the webview (e.g. a link in content navigates away), its JS can call the
  exposed native functions and read files.
- Backend FS ops must be contained to the loaded directory; a compromised dep
  shouldn't get directory-listing / arbitrary-file access.
- You asked: can the app shell be hardened against a supply-chain-compromised dep?

**What already exists (good news):**

- `gui/src/security.cpp::within_base` is enforced in `scheme.cpp`
  (`handle_app_request` — `/content/`, assets, updater root all call
  `security::within_base`). Path traversal is already blocked.
- `gui/src/security.cpp::check` blocks non-allowlisted remote hosts (only
  `app://`, `localhost`, whitelisted hosts are `allow`; others are `prompt`).

**Approach (layered):**

1. **Bridge token.** At GUI startup generate a random per-session token; inject it
   into the trusted page only (e.g. a `<meta name="app-token">` set when serving
   `app://`, or pass via `getInitialState`). The native bridge (`gui/src/bridge.cpp`)
   rejects any call whose envelope lacks/ mismatches the token. A foreign page
   (evil.com) won't have the token → calls rejected. Mirror the check on the JS
   side in `bridge/native.ts::callBridge` (require token in args/envelope).
2. **Contain backend to loaded dir — reflected in frontend.** The scheme handler
   already scopes to `cfg.root()`; extend `bridge.cpp` FS ops to reject paths
   outside the active content root too, and have the JS providers only ever
   request content-relative paths (they already do — `fs-provider.ts`,
   `mount-provider.ts`). Add an explicit assertion in `callBridge` that the
   requested path is within the root.
3. **Navigation/context lockdown.** Tighten `security::check`: never navigate the
   main webview to an external origin from in-app links (open externally instead);
   keep `app://` as the only script-executing origin.
4. **Supply-chain resilience:**
   - Ship a strict **Content-Security-Policy** for the `app://` origin (no
     `connect-src`/`script-src` to external hosts; `unsafe-inline` avoided by the
     existing SW/Farm bundle). This limits a compromised dep's exfil/execution.
   - Keep the **thin-shell / FullBundle** split (`AppFunc.FullBundle`) so the
     runtime only loads vetted chunks; the SW (`updater-core`) already verifies
     manifest entries.
   - Add **Subresource Integrity / hash pinning** for any optional remote fetch
     (updater), and a lockfile check in CI (`bun install --frozen-lockfile`
     already used in `editor/predep.toml`).
   - The native `within_base` + `is_api_path` whitelist already prevents a bad
     in-page dep from reaching files outside root via the scheme.

**Open questions for you:** (a) token delivery mechanism (meta tag vs
`getInitialState` payload) — I recommend meta tag set at `app://` serve time;
(b) whether to also restrict the JS bridge surface to a minimal allowlist of ops.

**Files.** `gui/src/bridge.cpp`, `gui/src/security.cpp`,
`editor/src/bridge/native.ts`, `editor/src/bridge/interface.ts`,
`gui/src/scheme.cpp` (CSP header), Eta `<head>` (CSP meta).

**Verify.** `bun --bun tsc --noEmit` + C++ build (`predep gui::build`); manual:
load an external site in the webview and confirm bridge calls are rejected; confirm
`within_base` still blocks `../` traversal.

---

## 5. Recent files limited to 10

**Problem.** The _project_ (dir) list `recentProjectsStore`
(`editor/src/stores/recent-projects-store.ts`) is **already** capped at
`MAX_RECENTS = 10`. But the per-provider **file** list `recentsStore`
(`editor/src/stores/recents-store.ts:36`) caps at **50** (`slice(0, 50)`), which is
what the home/empty screen shows. The user wants the visible recents capped at 10.

**Approach.** Change `recents-store.ts:36` from `slice(0, 50)` to `slice(0, 10)`
so both lists cap at 10. (Also confirm `recentProjectsStore` 10-cap is the desired
behavior — it already is.)

**Files.** `editor/src/stores/recents-store.ts` (one-line change).

**Verify.** `bun --bun tsc --noEmit`; open >10 files, confirm only the 10 most
recent remain in `recentsStore.getRecents()`.

---

## 6. Don't auto-format the whole file on open — offer a suggestion instead

**Problem.** On open, the editor parses the raw markdown into a ProseMirror doc,
then its serializer re-emits canonical markdown. The dirty-tracking layer
(`editor/src/services/dirty-tracking-service.ts`) compares the re-serialized
`body` to `baseline` (raw disk body). For a non-canonical file, `body !== baseline`
→ it **auto-queues a whole-file "formatted" Edit op**
(`queueEdit` at lines 78 / 161; the file-sync discard comment at line 814–816
explicitly calls this out as a "formatted" pending Edit op). The user wants: don't
auto-reformat; instead surface a "this file can be formatted" suggestion, and only
format the sections the user actually edits.

**Approach.**

- **Stop auto-queuing the whole-file format op on open.** The re-serialization
  difference on first load should NOT mark the file dirty. Keep `baseline` = raw
  disk body; when the in-memory doc is first built, do not let the diff against the
  canonical serialization create an Edit op. (Edited sections already get
  re-serialized only where the user changed them, so "format edited sections" is
  largely the existing per-edit behavior — the fix is to stop the _whole-file_
  auto-format.)
- **Surface a suggestion instead.** Add a lightweight "File can be formatted —
  Format" affordance (topbar/dirty badge or a non-blocking toast) computed by
  diffing `serialize(doc)` vs `baseline` _without_ queuing an op. Clicking it runs
  a one-shot format (serialize whole doc → queue a single intentional Edit op), so
  the user opts in.
- This must respect the content-state invariants in `editor/AGENTS.md` (body-only
  storage, `?? ""` not `||`, no no-op Edit op) so we don't regress the
  "metadata discarded / body cleared on re-open" bugs.

**Files.** `editor/src/services/dirty-tracking-service.ts` (guarding the open-time
diff), `editor/src/controllers/topbar-controller.ts` or a new suggestion
component, `editor/src/entities/PendingOps.ts` (manual format op),
`editor/src/config/editor-markdown.ts` (serializer already at line 1005).

**Verify.** `bun --bun tsc --noEmit`; open a non-canonical `.md` — confirm no
pending op appears automatically, the suggestion shows, and "Format" produces a
single intentional op; re-open shows metadata intact (no empty body).

---

## Build/verification conventions (per AGENTS.md)

- Type-check: `bun --bun tsc --noEmit` after every change.
- CSS/Eta changes: run `bun lib/build.ts`.
- No Playwright/E2E unless you ask.
- Prefer `hasFunc(AppFunc.X)` over `BuildMode` checks; never bind window events
  outside `keyboard.ts`; never edit `node_modules`.

## Suggested implementation order

1. #5 (trivial, unblocks #3's testing) → 2. #1 (editor, self-contained) →
2. #3 (editor boot) → 4. #6 (editor, careful) → 5. #2 and #4 (architectural,
   confirm open questions first).
