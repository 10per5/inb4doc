# Agent Notes — inb4doc editor

## Rules

- **Never modify `node_modules/`** — use custom Milkdown plugins or project source files instead.
- **Never create postinstall/patch scripts** that modify node_modules at install time.
- **No raw global (document/window) event bindings outside `src/plugins/keyboard.ts`.** All global key handling is a static list in `src/plugins/keyboard.ts` (the `globalKeyBindings` array), which owns the single document-level `keydown` listener. Its handlers emit app events (e.g. Escape → `AppEvent.SidebarCancel`); controllers subscribe to those events instead of registering their own document listeners. Editor keybindings live in the Milkdown keymap (`createKeymap`) in the same file. Do NOT call `document.addEventListener` in controllers, services, or other plugins.
- **Do not run Playwright/E2E browser tests unless the user explicitly asks.** Verify changes with `bun --bun tsc --noEmit` and static reasoning; leave E2E repro scripts out of the repo (keep them in `/tmp/opencode/` only if asked).

## Content State Invariants (metadata / content-loss regressions)

File content is stored **body-only**; frontmatter lives separately (`Page.frontmatter`, pending edits carry a `frontmatterPatch`). Several subtle invariants prevent metadata/content loss when a page is re-opened, flushed, or shown in the pending-changes dialog. Breaking any of them resurfaces the "metadata shows as discarded" / "body cleared on re-open" regression.

1. **`Page.bodyState.body` must always be set to the loaded content.** It is the authoritative "current body" used by `onMetaDataChanged` (dirty-tracking-service), `applyNoConflict`, `executeConflictDecision`, `reloadCurrentFromDisk`, and `Page.flushIn`. If a page loads but `bodyState.body` stays `undefined`, a metadata-only edit produces an Edit op with `patch = ""` → re-open shows an empty doc and flush can wipe the real body. Set `bodyState.body` anywhere you set `setBaseline()` on a freshly read page.

2. **Empty string is a valid body state** (a cleared file). Use `!== undefined` / `?? ""` checks on `op.patch` / `page.bodyState.body`, NEVER `||` truthiness. `if (op.patch)` skips the empty patch and falls through to disk re-read or body-only editor content, resurrecting old content and dropping metadata. `getDirtyPaths()` must include Edit ops even when `patch === ""`.

3. **The changes dialog "current" side must include the pending frontmatter.** Build `md` from `body` + `page.getFrontmatter()` (fall back to `originalFrontmatter` merged with `op.frontmatterPatch`). If you fall back to `editor.getCurrentContent()` it is **body-only** — diffing it against the original makes `diffFrontmatter` report every metadata field as `removed`. Only re-read from disk when `md === undefined`, never when `md === ""`.

4. **Metadata-only edits queue an Edit op with `patch =` the current body** (`onMetaDataChanged` uses `page.bodyState.body ?? ""`). Keep `bodyState.body` in sync (invariant 1) so `patch` carries the real body; `flushDirtyFiles`/`flushPendingEdit` must then trust `editOp.patch ?? page.bodyState.body ?? ""`.

5. **The dirty plugin's "uninitialized" sentinel is `undefined` (absent key), never `""`.** `src/plugins/dirty.ts` uses `prevLastSet === undefined` to mean "a programmatic content set happened; re-baseline from the doc". An empty serialized doc is a **valid baseline** (`""`), so using `""` as the sentinel made cut→flush→reopen→paste invisible to dirty-tracking. Programmatic sets must `lastSetContent.delete(path)` (not `.set(path, "")`) before the state update so the plugin absorbs only the programmatic update; `ensureEditor` primes the baseline by serializing the created doc. Do not reintroduce a string sentinel that collides with real content.

6. **Never create or keep a no-op Edit op.** `onMetaDataChanged` (dirty-tracking-service) must not `queueEdit` when neither the frontmatter changed nor the body differs from baseline, and must `remove` an existing Edit op when `frontmatterPatch` becomes `undefined` and `patch === baseline` (e.g., a metadata change reverted to its original value). Otherwise a revert leaves an op that diffs as "No changes" but still shows `Pending changes (1)` / `+0B unflushed`.

## Architecture — Stimulus + Eta

### Controller Hierarchy

```
ShellController (#app, data-controller="shell", data-shell-editor-outlet="#editor-area")
├── TopbarController (.app-toolbar, data-controller="topbar")
│   ├── FileMenuController (data-controller="file-menu")
│   └── ViewMenuController (data-controller="view-menu")
├── SidebarController (#sidebar-nav, data-controller="sidebar")
├── EditorController (#editor-area, data-controller="editor") ← outlet of ShellController
├── NavigationService (plain class, receives editor + cache via constructor)
├── FileSyncController (plain class, no DOM)
└── ViewController (plain class, accesses editor targets for element visibility)
```

- **Stimulus controllers** own DOM elements and have `static targets` for child references. They are registered in `src/app.ts` via `app.register("name", ControllerClass)`.
- **Plain class controllers** receive Stimulus controllers as constructor args for cross-controller calls. They do NOT use `document.getElementById`.
- **ShellController** is the composition root: finds child Stimulus controllers via `this.application.getControllerForElementAndIdentifier()`, creates plain class sub-controllers, wires event subscriptions, and runs the async initialization lifecycle.
- **Event bus** (`appEvents`) is the primary decoupling mechanism. Controllers emit user-intents; other controllers subscribe.
- **Prefer array payloads over twin events.** Do NOT add a second event (e.g. `FooRequested` + `FooManyRequested`) for the same action just to support a batch. Model the payload as an array and let a single operation be a one-element array. Examples: `SidebarDeleteRequested` carries `{ paths: string[] }` (delete one page = `paths: [path]`), `SidebarWeightsRequested` carries `{ weights: [...] }` (single reorder = one-element array). There is deliberately no `*ManyRequested` event and no separate `setPageWeight`/`deletePage` function — the array form handles both. Similarly prefer one batching backend endpoint (`POST /api/delete` taking `{ paths }`) over N single deletes.

### Stimulus Outlets

Outlets connect a parent controller to a child controller's element. The attribute goes on the **parent** controller element, and its value is a **CSS selector** for the child element (NOT the child's controller identifier):

```html
<!-- CORRECT: attribute on parent, value is CSS selector -->
<div data-controller="shell" data-shell-editor-outlet="#editor-area">
  <div id="editor-area" data-controller="editor"></div>
</div>

<!-- WRONG: attribute on child, value is identifier -->
<div data-controller="shell">
  <div data-controller="editor" data-shell-editor-outlet="editor"></div>
</div>
```

The callback is `{outletName}OutletConnected(outlet, element)` on the parent controller. It fires when both the parent and outlet controllers are connected and the outlet element matches the selector.

### Stimulus Initialization Order

Use `new Application()` → register all controllers → `await app.start()`. Do NOT use `Application.start()` which starts DOM observers before controllers are registered:

```ts
const app = new Application();
app.register("shell", ShellController);
app.register("editor", EditorController);
// ... register all controllers ...
await app.start();
```

`app.register()` immediately connects controllers if matching DOM elements exist. `app.start()` starts the MutationObserver for future DOM changes.

### TypeScript `declare` for Stimulus Targets/Values

With `target: "ESNext"` (or `useDefineForClassFields: true`), TypeScript compiles `foo!: HTMLElement` to `this.foo = undefined` in the constructor, which **shadows** the Stimulus prototype getter that queries the DOM. Always use `declare` for Stimulus-managed properties:

```ts
// CORRECT: declare emits no runtime code
declare readonly sidebarTarget: HTMLElement

// WRONG: shadows Stimulus getter with undefined
sidebarTarget!: HTMLElement
```

This applies to all `static targets`, `static values`, and `static outlets` blessed properties. Private fields assigned manually (e.g., `private editor!: EditorController`) are fine with `!` since they don't shadow Stimulus getters.

### DOM Element Access

- **Stimulus targets**: Use `static targets = ["name"]` + `this.nameTarget` to reference child elements. The controller's element is `this.element` (typed as `Element`, cast to `HTMLElement` when needed for DOM APIs).
- **Cross-controller access**: Use `this.application.getControllerForElementAndIdentifier(element, "controller-name")` to find another controller. Call this lazily in `connect()` body or `initialize()` — children connect after parent in Stimulus DOM order.
- **Never use `document.getElementById`** in controllers or view components. All element access goes through Stimulus targets or constructor-injected references.
- **Exception**: Global UI cleanup (e.g., `document.querySelectorAll(".toolbar-menu.open")` to close menus) is acceptable.

### Loading Skeleton

There is no full-screen loading overlay. `shell.eta` renders skeleton placeholders directly in the layout slots (`skeleton-topbar`, `skeleton-sidebar`, `skeleton-editor`, `skeleton-meta` partials). Their styles live in `lib/style/loading.css` (a build-time asset inlined into `<head>` by `lib/build.ts`) so they paint before `app.css` / JS arrive. Each controller replaces its skeleton with the real view on `connect()` — no explicit hide step is needed. Do not reintroduce a blocking overlay or logo animation.

### Eta Templates

- **Build-time rendering**: `build.ts` renders `shell.eta` → `public/index.html`. Partials in `src/templates/partials/` are included via `<%~ include('partial-name', it) %>`.
- **Template context**: `build.ts` passes `it` with `BUILD_MODE`, enum prefixes (`TOOLBAR_ACTION_PREFIX`, `SIDEBAR_ACTION_PREFIX`, etc.), enum objects (`ToolbarAction`, `SidebarAction`, etc.), `icons`, `showMobileButtons`, etc.
- **Include paths**: Partials include other partials with just the filename (e.g., `include('source-editor', it)`), NOT with `partials/` prefix. The Eta `views` root is `src/templates/`.
- **Stimulus attributes in templates**: Use `<%= it.ENUM_PREFIX %><%= it.Enum.Value %>` for `data-action` values. Use `data-controller="name"` for Stimulus bindings. Use `data-name-target="target"` for targets.
- **Partials are compiled at build time** — the Eta compiler never ships to the browser. Compiled templates (`.eta.ts`) are used for runtime rendering (e.g., `mobile.eta`).
- **Icons**: Pass SVG icon strings via the template context (`it.icons.boldIcon`), not imported directly in templates.
- **Eta tags used in this codebase** — exactly three, so pick deliberately:
  - `<% code %>` — scriptlet (control flow). Used for `if`/`for` conditionals, nothing else.
  - `<%= it.x %>` — **escaped** output (compiles to `__eta.e(it.x)`). Use for all text, labels, and attribute values.
  - `<%~ it.x %>` — **raw** output (no escaping). Use ONLY for prebuilt markup you control: icon SVGs, `childrenHtml`, `include('partial', it)`.
  - The compiled function tells you if you picked wrong: `<%=` shows up as `__eta.e(...)` (escaped), `<%~` as a plain `res+=...`.
  - Gotcha: `<%= it.childrenHtml %>` in `submenu.eta` once escaped the nested item markup, so the "No recent projects" empty state rendered as literal HTML tags in the DOM instead of elements.

### Int-Based Enum Pattern

- Each domain has a short prefix: `tb-` (toolbar), `sb-` (sidebar), `sc-` (slash), `img-` (image), `dlg-` (dialog), `prov-` (provider), `proj-` (project), `ed-` (editor).
- `data-action` attributes use `PREFIX${EnumInt}` format: `data-action="tb-0"`.
- Handler parsing: `Number(str.replace(PREFIX, "")) as EnumType`.
- CSS uses classes (`.ctx-action`, `.action-delete`) not `[data-action="value"]` selectors.
- Enum values are ints for HTML compactness; the enum exists for type safety and documentation.

### Build Commands

```bash
bun lib/build.ts     # Full build: Eta render → CSS → Farm bundle → SW + KaTeX assets
bun lib/dev.ts       # Dev server: Farm watch build + static serve + eta recompile
bun --bun tsc --noEmit # TypeScript check
```

### Build Mode and AppFunc

- `BuildMode` is the deployment target: `web-remote`, `web-local`, `gui-desktop`, `gui-mobile`.
- `AppFunc` is a bitmask of feature flags derived from the current build mode via `hasFunc()`.
- **Prefer `hasFunc(AppFunc.X)` over checking `BuildMode` directly.** This keeps runtime behavior decoupled from the deployment target and makes it easy to add new modes without scattering mode-name checks.
- Meta tags in `templates/partials/head-meta.eta` are the bridge between build-time config and runtime. When adding a new build-time value, add the meta tag there and read it in `src/config/index.ts`.

## Supported Formatting in WYSIWYG

- **CommonMark** — via `@milkdown/kit/preset/commonmark`
- **GFM** — via `@milkdown/kit/preset/gfm` (tables, strikethrough, task lists, auto-links)
- **Markdown alerts** (`> [!NOTE]`, `> [!WARNING]`, etc.) — custom `$remark` + `$nodeSchema` in `src/plugins/alert.ts`
  - Transforms MDAST blockquote nodes with `[!TYPE]` prefix into custom `alert` nodes
  - Renders as `<blockquote class="book-hint TYPE">` in the editor
  - Serializes back to `> [!TYPE] ...` syntax
  - Supported types: note, tip, important, warning, caution, info, success, danger

## Clipboard / Paste

- `@milkdown/plugin-clipboard` activated via `.use(clipboard)`
- Handles VS Code paste detection (code block with language)
- Handles Google Docs multi-table paste (strips `docs-internal-guid` wrapper)
- If rich paste formatting is still lost, add a `$prose` plugin with turndown HTML→Markdown conversion

## Hugo Shortcodes — Decoration + Text Handler Override

Shortcodes use `src/plugins/shortcode.ts`:

1. **`$prose` decoration plugin** (`shortcodeDecoration`): Styles `{{<...>}}` / `{{%...%}}` text patterns as styled badges. Uses a stack-based approach to match opening/closing shortcode pairs and adds `.shortcode-body` decoration to content between them. Uses a local regex instance to avoid `lastIndex` conflicts.

2. **Text handler override** in `editor_controller.ts` config: Overrides the `text` handler via `remarkStringifyOptionsCtx`. For text nodes containing `{{`, returns the raw value directly (skipping `state.safe()`), preventing `[` from being escaped to `\[`. This avoids `$remark` race condition issues since it's applied in the config callback.

Regex (decoration): `/\{\{(<|%)\s*\/?\s*(\w+(?:\.\w+)?)((?:\s+(?:"[^"]*"|\[[^\]]*\]|\S+))*)\s*[>%]\}\}/g`

Supported syntax:

| Part | Class | Style |
|---|---|---|
| Shortcode tag | `.shortcode-tag` | gray border, monospace |
| Content between paired tags | `.shortcode-body` | subtle blue background |
| `{{< param ... >}}` | `.shortcode-param` | teal border |
| `{{< details ... >}}` / `{{< /details >}}` | `.shortcode-detail-tag` | blue border, bold |
| `{{% ... %}}` | `.shortcode-percent` | purple border, italic |

## Backend Compatibility

Only backend: **Hugo + Hugo Book theme** (v0.14.0)

- Formatting table in `content/docs/backends.md`
- Hugo Book shortcode reference: <https://book.alxs.dev/docs/content/shortcodes/>
- Hugo shortcode reference: <https://gohugo.io/content-management/shortcodes/>

## Inline / Floating Element Patterns

When rendering popups, pickers, or floating UIs that must anchor to a ProseMirror position:

### SlashProvider (recommended for `/cmd` menus)

Uses `@milkdown/plugin-slash`'s `SlashProvider`. The provider positions itself via `posToDOMRect(view, from, to)` using the current text selection. The positioning happens inside `#onUpdate` which is called by `provider.update(view, prevState)` — debounced at 20ms by default.

**Key flow:**

1. Set a `#programmaticPos` before calling `provider.show()`
2. In the `shouldShow` callback, read `#programmaticPos`, validate the position node matches the selection node, then return true
3. The provider calls `posToDOMRect(view, from, to)` to compute position → `computePosition()` via Floating UI → sets `left`/`top` on the element

**Gotchas:**

- `provider.show()` only sets `data-show="true"` — it does NOT position the element. Positioning requires `provider.update()` → `#onUpdate` to fire (debounced).
- `shouldShow` returns false if `#programmaticPos` resolves to a different node than `selection.from` — important guard against stale positions.
- For immediate positioning without waiting for the debounce, manually compute coords:

  ```ts
  const coords = view.coordsAtPos(pos);
  element.style.left = `${coords.left}px`;
  element.style.top = `${coords.bottom + 4}px`;
  ```

### ProseMirror Plugin with `handleDOMEvents`

For user interactions on specific nodes (e.g., double-click on an image), use a `Plugin` with `props.handleDOMEvents`:

```ts
new Plugin({
  key: new PluginKey("my-handler"),
  props: {
    handleDOMEvents: {
      dblclick: (view, event) => {
        const target = event.target as HTMLElement;
        const el = target.closest("[data-my-attr]");
        if (!el) return false;
        const pos = view.posAtDOM(el, 0);
        // dispatch custom event or open a popup
        view.dom.dispatchEvent(new CustomEvent("my-custom-event", {
          bubbles: true, detail: { pos, ... }
        }));
        return true;
      },
    },
  },
})
```

Listen for the custom event on `view.dom` in the component that manages the popup. This decouples the ProseMirror plugin from the UI code.

### Avoiding Position Flash

When a floating element transitions from hidden to shown, it may briefly appear at (0,0) before `#onUpdate` repositions it. To prevent this:

1. Set CSS `left`/`top` BEFORE calling `provider.show()` using `view.coordsAtPos(pos)`
2. Set `data-show="false"` on the element until coordinates are computed, then set to `"true"`

## Bundle Analysis

To analyze bundle size and find bloat:

```bash
bun build src/app.ts --outdir /tmp/analyze --minify --metafile-md=/tmp/analyze/report.md
```

This generates an LLM-friendly markdown report with largest modules, dependency chains, and optimization opportunities. Use `--splitting` to see lazy chunk breakdowns. The JSON version (`--metafile=meta.json`) works with tools like `esbuild-visualizer`.

### Known size issues

| Asset     | Size           | Cause                                                                                                                                  |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `app.js`  | 1.3 MB initial | Milkdown + ProseMirror + CM core                                                                                                       |
| `app.css` | 1.5 MB         | `katex/dist/katex.min.css` has `@font-face` blocks → Bun inlines all woff2/woff/ttf fonts as base64 data URIs (~60 font files, 1.2 MB) |

## Playwright Testing

For any behavior that depends on the real app runtime (Stimulus connect timing, view switching, providers, SVG/browser rendering), use **Playwright + Chromium** against the built app. Do not rely on happy-dom-style mocks for these — DOM-lite environments hide runtime errors that a real browser surfaces as `pageerror`/console errors.

### Tooling

- devDeps: `@playwright/test` + `@playwright/browser-chromium`.
- Chromium binary: `bun x playwright install chromium` (the browser-chromium package does not auto-install; the postinstall is blocked by bun by default).
- **Browser location:** always install with `PLAYWRIGHT_BROWSERS_PATH=0 bun x playwright install chromium` so the binary lives in `node_modules/playwright-core/.local-browsers/` instead of `~/.cache/ms-playwright` (which gets wiped). The `PLAYWRIGHT_BROWSERS_PATH` env var is read at module load, so it must be set before `@playwright/test` is imported.
- **Shared bootstrap:** standalone scripts should `import { chromium } from "../e2e/launch"` (re-exported from `e2e/launch.ts`), which sets `PLAYWRIGHT_BROWSERS_PATH` to the project-local install before dynamically importing `@playwright/test`. Do not `import` `@playwright/test` directly in scripts — `playwright.config.ts` is **not** loaded for standalone `bun e2e/<test>.ts` scripts (it only applies to `bun playwright test`).
- Test server: `bun lib/serve.ts` serves the built `public/` and reads content from `../../content`.

### Port convention

Use a **distinctive, far-from-common port** so the test server never collides with a dev server or anything already bound. The canonical test port is **`32600`** — memorable as "big far clear". Common ports (3000, 5173, 8080) are frequently already taken; check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:32600/` before assuming the server is up.

### Workflow

```bash
bun lib/build.ts                              # build the app into public/
PORT=32600 bun lib/serve.ts &                 # serve it (background)
bun e2e/<test>.ts                             # run a Playwright script (top-level await OK)
```

### Script template

```ts
import { chromium } from "../e2e/launch";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto("http://localhost:32600/", { waitUntil: "load" });
await page.waitForTimeout(3000); // let the app boot + controllers connect

// ... interact with the real DOM ...
await page.screenshot({ path: "/tmp/opencode/out.png" });
console.log(JSON.stringify(await page.evaluate(() => { /* inspect state */ }), null, 2));
console.log("ERRORS:", errors);
await browser.close();
```

### Gotchas

- **Always capture `console` errors + `pageerror`** — the root cause usually shows up there (e.g., a thrown TypeError in an async handler that a happy-dom test never executes).
- Locate interactive elements by their rendered label/`data-action` (`#menu-panel-2 [data-action="menu-item"]`), not by guessing selectors.
- Wait generous boot time after `goto` — the app is a large bundle and controllers connect asynchronously.
- Use `page.evaluate` with `getComputedStyle`/`getBoundingClientRect` to verify *visible* state, not just DOM presence (an element can exist with `display: none`).
- Keep throwaway repro scripts in `/tmp/opencode/`; keep reusable checks in `e2e/`.

### Cache / connection injection

The app's **remote connection store defaults to `localhost:3000`**. To point a Playwright session at the e2e server, the connection must be seeded in `localStorage` **before the app bundle runs** — use `page.addInitScript`, not `page.evaluate` after `goto` (the app reads it during boot):

```ts
await page.addInitScript(() => {
  localStorage.setItem("inb4doc:connections:0", JSON.stringify({ host: "localhost", port: 32600 }));
});
```

- Storage keys are namespaced `inb4doc:<type>:<id>` (see `src/services/storage.ts` `entityKey()`). The connection key is `inb4doc:connections:0` — `STORE_CONNECTIONS = "connections"` (`src/config/storage-keys.ts`) and provider id `0` (the single remote provider).
- Pending ops persist under `inb4doc:pending-ops:<providerId>/<path>` (`STORE_PENDING_OPS`, per-path entries). Useful to inspect `localStorage` in `page.evaluate` to confirm an op was queued without waiting for UI.
- The served content repo is `../../content` relative to the editor. After an edit, re-read the file with `page.request.get("http://localhost:32600/content/<path>.md")` to assert what actually hit disk (e.g., title persisted in frontmatter).

## Template HMR (Hot Module Replacement)

When a controller's template file (Eta) or the controller itself is edited, the build produces a new chunk. The SW detects the change, activates, and calls `registry.swap()` to re-import the controller module. `ModuleRegistry.swap()` unloads the controller identifier, re-imports the module, and re-registers the class.

Controllers do **not** implement `refresh()` — view components are re-mounted and call `load()` again on the next activation with fresh data.

**Sidebar decoupling**: `NavigationService` and `SidebarController` are fully decoupled via the event bus. The sidebar self-sources its data on each load (from `treeStore`, `pendingOpsStore`, provider-store, and `getCurrentPath()`), and its actions emit `AppEvent.Navigate` / `AppEvent.Sidebar*Requested` events that `NavigationService` handles. `NavigationService.loadSidebar()` is purely a re-render trigger (`AppEvent.SidebarReload`). Do NOT reintroduce direct sidebar references into services.

### Pending Image Lifecycle

Pending images (unflushed) are tracked in `ImageRegistry` with `pendingByDir`. They appear in `getAllImages()` alongside known (committed) images. When discarded or deleted:

- **Discard All** must call `imageRegistry.removeAllForDir(dir)` (added in `CacheManagementService.onDiscardAll`)
- **Single delete** via Image Manager must call `imageRegistry.removePending(id)` (handled in `deleteImage()` for names starting with `pi-`)
- **Flush** calls `commitPending(dir)` which uploads the file, builds the URL map, then removes from registry
