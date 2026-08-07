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
