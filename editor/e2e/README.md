# e2e / Playwright guidelines

These are the operational conventions for running Playwright against the built
app. They exist because every one of these was a wasted-credit mistake at some
point. Read them before launching a browser.

## Port: use `32600`, never 3000

- Canonical test port is **`32600`**. `3000` is the *dev* server port and is
  frequently already in use — do not assume it is free.
- **Before assuming a server is up, check it:**
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:32600/` → expect `200`.
- If a dev server is already running on 3000, **do not start a second one.** It
  will collide (`EADDRINUSE`), crash `serve.ts`, and leave a stray
  `build.ts --watch` that fights the real server over `public/sw.js`. Check
  first: `ps -eo pid,args | rg 'dev\.ts|serve\.ts|build\.ts'`.

## Running a server

Dev server (watch build + eta recompile + serve) on the test port:

```bash
PORT=32600 bun lib/dev.ts > /tmp/opencode/dev.log 2>&1 &   # dev.ts passes PORT through to serve.ts
```

Static serve of a prebuilt `public/` (for stateful tests, no rebuilds):

```bash
bun lib/build.ts && PORT=32600 bun lib/serve.ts &
```

Shell gotchas:

- **`nohup` does not exist in this environment.** Use
  `bun lib/dev.ts > /tmp/opencode/dev.log 2>&1 &` instead.
- `bun lib/dev.ts` recycles leftover dev/serve/build processes when run on a
  TTY, but **aborts in a non-TTY shell** if leftovers exist. Kill strays first.
- The build takes ~10–30 s. Wait for the port to answer with `200` before
  running a script — never `goto` an unready server.

## Bootstrap

- Standalone scripts: `import { chromium } from "../e2e/launch"` for scripts in
  `e2e/`; for scripts in `/tmp/opencode/` use the absolute path
  `/home/user/project/editor/e2e/launch`. Never import `@playwright/test`
  directly — `playwright.config.ts` is not loaded for standalone scripts, and
  the browser lives in the project-local `PLAYWRIGHT_BROWSERS_PATH` that
  `launch.ts` sets.
- Point the app at the test port **before** the bundle runs:

```ts
await page.addInitScript(() => {
  localStorage.setItem("inb4doc:connections:0", JSON.stringify({ host: "localhost", port: 32600 }));
});
```

- **Always** capture console errors + `pageerror`; the root cause usually shows
  up there:
  `page.on("console", m => { if (m.type() === "error") errors.push(m.text()) })`
  and `page.on("pageerror", e => errors.push(e.message))`.
- Wait for a real selector (e.g. `#sidebar-nav .sidebar-wrapper`), not a blind
  `setTimeout`.

## Keep repro scripts out of the repo

- Throwaway repro scripts → `/tmp/opencode/`. Only reusable checks live in
  `e2e/`. Do not commit Playwright scripts unless the user asks.
- If a repro needs to edit a tracked file (e.g. inject a marker into
  `templates/views/controller/sidebar.eta`), **restore the file afterward** and
  confirm `git status` is clean.

## Reusable e2e classes

The `e2e/` helpers are organized as small classes; import them and inject the
browser yourself:

```ts
import { chromium } from "/home/user/project/editor/e2e/launch";
import { EditorSession } from "/home/user/project/editor/e2e/session";
import { DragHarness } from "/home/user/project/editor/e2e/drag";
import { DomTimeline } from "/home/user/project/editor/e2e/dom-timeline";
import { CssProbe } from "/home/user/project/editor/e2e/css-probe";

const browser = await chromium.launch();
const session = await EditorSession.open(browser, "e2e-video-drop");

const drag = await DragHarness.attach(session);
await drag.selectBlockNode(".video-wrapper video");          // NodeSelection
await drag.startNativeDrag(".video-wrapper video");          // real dragstart → seeds view.dragging
await drag.dispatch("dragEnter", x, y);                      // CDP moves the drag (mouse.move won't)
await drag.dispatch("dragOver", x, y);
console.log(JSON.stringify(await drag.dragLog()));           // drag events + elementFromPoint
```

Classes:

- **`EditorSession`** (`session.ts`) — boot a page wired to :32600
  (`localStorage` seeded before the bundle runs via `addInitScript`), capture
  console/page errors into `session.errors`, and assert what hit disk/DOM vs.
  what only flickered in the editor (`contentOnDisk`, `pendingOps`, `tableBox`).
- **`DragHarness`** (`drag.ts`) — native drag simulation. A real drag is
  started with real mouse events (`startNativeDrag`); that is the only thing
  that fires `dragstart` and lets PM seed `view.dragging`. Once dragging, the
  drag is moved **only** via CDP `Input.dispatchDragEvent` (`dispatch`) —
  `page.mouse.move` alone does not fire `dragover`. `installDragLog`/`dragLog`
  record every drag event plus the in-page `elementFromPoint` result.
- **`DomTimeline`** (`dom-timeline.ts`) — a unified-clock MutationObserver
  that records `class` mutations and element add/remove for a set of watch
  selectors (default: table blocks, video wrappers, ghost). Stable per-element
  ids make element **replacement** visible — the case where a highlighted
  cell's classes vanish with no class mutation because its element was
  re-rendered.
- **`CssProbe`** (`css-probe.ts`) — "which stylesheet rule paints this
  element". `computedStyle(sel, props)` reports computed outline/background;
  `matchingRules(sel, props)` walks every stylesheet and returns the rules
  whose selector matches, optionally filtered to declared properties.

## Salt vs. meat — pick the cheaper check first

Reproducing a runtime behavior in a browser is **salt**: one Playwright run
costs a build, a boot, connection seeding, CDP drag dispatch and ~10-60 s, and
every run is a fresh, flaky context. Reading the actual source that decides
the behavior is **meat**: deterministic, offline, a few targeted reads. Before
reaching for a browser, decide which side the question lives on.

Prefer **meat** (read the source) when the question is:

- "Which handler runs, in what order, and who registered it" — event-listener
  ordering and gating live in the code (PM `initInput`/`eventBelongsToView`,
  the table-block `stopEvent`, `EditorView` constructor order).
- "Who dispatches a transaction / what re-renders the DOM" — a single call
  chain traced through the plugin sources settles it.
- "Why does feature X behave like this" in the first place — start with the
  docs/issue tracker/web search before either grepping or running a browser.

Prefer **salt** (the browser) when the question is:

- "Does the thing actually *paint* / is it *visible*" — computed styles,
  outline colors, layout — only a browser knows.
- "Does this re-render replace DOM element identity" — needs a runtime
  MutationObserver; you cannot conclude it from source alone.
- "Did the fix work end-to-end" — a confirming pass after the source-level
  change is understood.

Rules of thumb:

- If one read of 30-100 lines settles it, reading is cheaper than any run.
- If you do run the browser, make it count: one instrumented run with a
  unified-clock log (`DragHarness.installDragLog`) beats five
  click-and-dump runs. Move helpers you reuse into `e2e/dnd.ts`, not into
  `/tmp/opencode/`.
- Don't chase an answer in `node_modules` with more greps when the question is
  runtime-observable, and don't launch browsers when the question is
  source-observable. When in doubt, ask which the user wants.

## Template-HMR / SW swap repro recipe

To observe a hot swap vs. reload without a real editor session:

1. Inject a unique marker per pass, e.g. replace `<div class="sidebar-wrapper">`
   with `<div class="sidebar-wrapper" data-pass="N">` in the `.eta`. The dev
   server recompiles `.eta` → `src/eta/*.ts` → Farm rebuilds → `sw.js` updates.
2. Detect reloads with `page.on("framenavigated")` filtered to the main frame
   (`f.frame() === f.frame().mainFrame()`).
3. For each pass, poll (100 ms) for the marker in the DOM. Marker present +
   no navigation ⇒ hot swap. Navigation ⇒ reload. Timeout ⇒ nothing applied.
4. Inspect Farm's loaded-resource set from the page to correlate `changed`
   decisions — find the module system by scanning window for
   `__farm_module_system__`, then read
   `ms.resourceLoader._loadedResources` (keys are the chunk names that
   `getLoadedChunkNames()` returns in `src/services/sw-registrar.ts`).

Relevant source when debugging swaps: `src/services/sw-registrar.ts`
(`applySwap`), `src/services/module-registry.ts` (`swap`, `getLoadedChunkNames`),
`lib/build/bundle.ts` (manifest: `affectedBy` / `coldOnChange`), `templates/sw.eta`.
