import "./styles/index";

import { Application } from "@hotwired/stimulus";
import { registerCoreControllers } from "@/controllers/core";
import { ModuleRegistry } from "@/services/module-registry-service";
import { setRegistry } from "@/services/registry-provider-service";
import { initializeProvider, setProviderReady } from "@/stores/provider-store";
import { appEvents, AppEvent } from "@/stores/app-events";
import { initNativeBridge } from "@/eta/bridge";
import { setSessionStarted } from "@/controllers/shell_controller";
import { initFarmCompat } from "$/farmfe-compat";
import { logger } from "@/utils/logger";
import { hasFunc, AppFunc, currentBuildMode, BuildMode } from "$/build/build-mode";
import { isMobileViewport } from "@/utils/mobile";

// Farm's chunk loader bakes a publicPath at build time; override it before any
// dynamic import. The default RELATIVE "assets/" resolves against the document
// URL, which is correct under http(s) root/subpath (web-remote, web-local), the
// desktop app:// scheme (gui-desktop is a FullBundle build, so every chunk ships
// in the install). The thin mobile shell is the one exception: the page loads
// from the bundled file:///android_asset/editor/ shell, but WebView does NOT
// call shouldInterceptRequest for file:///android_asset/ URLs (documented), and
// the thin APK ships no lazy chunks — so a relative base would resolve every
// lazy pot under android_asset and 404. Point the loader at the writable data
// dir instead (NativeBridge.editorMountUrl() returns its plain file:// base):
// WebView loads file:// from the app's own data dir natively (allowFileAccess),
// and shouldInterceptRequest backs it up for any request WebView defers.
const ANDROID_MOUNT = (() => {
  try {
    const nb = (window as any).NativeBridge
    const url = typeof nb?.editorMountUrl === "function" ? nb.editorMountUrl() : ""
    return typeof url === "string" && url ? url : ""
  } catch {
    return ""
  }
})()

// The mount is the JsStaticFs ROOT; the updater stores chunks under its
// assets/ subdir (pathForUrl keeps "assets/<name>"), so the thin loader base is
// the mount + assets/. Everywhere else (web, desktop FullBundle) falls back to
// the relative base, which resolves under the bundled install.
const thinShell = !hasFunc(AppFunc.FullBundle);
initFarmCompat(thinShell && ANDROID_MOUNT ? `${ANDROID_MOUNT}assets/` : "assets/")

// Web-local responsive-web (Part F): isMobileDock() (dock only on a mobile
// viewport for web modes) decides the chrome, and Stimulus registered the
// controller set from that at boot. Crossing the mobile/desktop breakpoint
// reloads so the dock layout (or the desktop chrome) wires up; the reload guard
// prevents loops on UA-only matches.
if (currentBuildMode() === BuildMode.WebLocal || currentBuildMode() === BuildMode.WebRemote) {
  let last = isMobileViewport();
  window.matchMedia("(max-width: 767px)").addEventListener("change", (e) => {
    if (e.matches !== last) {
      last = e.matches;
      location.reload();
    }
  });
}

const app = new Application();

// Part D two-stage entry. app.ts must never statically import the single-stage
// registration glue (its registerControllers pulls controllers/lazy → editor →
// node_imports, which would keep every @prosekit/* in the eager boot set). The
// eager graph ends at controllers/core; the editor + dialog controllers are
// always reached through a dynamic import. The glue itself is generated per
// build mode (templates/partials/register.eta → src/eta/register.ts): non-thin
// builds get the registerControllers used below, thin shells get a no-op.
//
// Thin shells (non-FullBundle — GuiMobile) register core synchronously, start,
// then register the lazy controllers so node_imports leaves the shipped boot
// set and the first-run updater downloads it. Web keeps the equivalent behavior
// through a dynamic registerControllers before start. Stimulus connects lazily-
// registered controllers for elements already in the DOM (the scope observer
// records data-controller scopes at start regardless of registration), so the
// editor outlet wires up once the lazy chunk arrives.
//
// Invariants for the split: core controller modules must not VALUE-import
// editor-controller, any dialog controller, or @prosekit/* (type-only imports
// are erased); interactive dialog opening goes through dynamic imports in the
// handlers.
const registry = new ModuleRegistry(app);
setRegistry(registry);

// Thin-shell first run: the lazy chunks exist only once the fetch updater has
// populated the writable data dir. Probe the updater storage BEFORE attempting
// the dynamic import, so boot never fetches chunks that 404 — the scheme serves
// an empty JS body for them, Farm's loader eval's it, and the resulting "module
// not registered" errors spam the console before the updater's reload. A
// missing bridge (plain-browser testing) means nothing can store an editor, so
// assume present and let the import try.
async function dataDirHasEditor(): Promise<boolean> {
  const exposed = (window as any).saucer?.exposed as
    | Record<string, unknown>
    | undefined;
  if (typeof exposed?.updaterHas !== "function") return true;
  try {
    const raw = (await (exposed.updaterHas as (p: string) => Promise<string>)(
      "index.html"
    )) as string;
    let data: unknown = raw;
    if (typeof raw === "string") {
      try {
        data = (JSON.parse(raw) as { data?: unknown })?.data ?? JSON.parse(raw);
      } catch {
        data = raw;
      }
    }
    return data === true || data === "true";
  } catch {
    return true;
  }
}

// Part D lazy registration for thin shells. The editor + dialog controllers
// live in lazy chunks that are never in the shipped dist/; on a thin shell's
// FIRST run the fetch updater hasn't populated the data dir yet, so the dynamic
// import would fail here — and that must never abort boot, or startUpdater never
// runs and the shell stays broken. dataDirHasEditor() skips the import entirely
// until the updater has stored the live editor (a probe, not a failed fetch), so
// first run boots clean; the updater's transfer + reload then boots a complete
// editor from the data-dir copy (the scheme serves it first). If it instead
// applies in place (hot swap), retry once after the swap so the editor still
// wires up.
async function registerLazy(app: Application, retried = false): Promise<void> {
  try {
    if (thinShell && !(await dataDirHasEditor())) {
      throw new Error("editor not in data dir yet — updater must populate it first");
    }
    const { registerLazyControllers } = await import("@/controllers/lazy");
    registerLazyControllers(app);
  } catch (err) {
    if (retried) return;
    logger.warn("boot", "lazy controllers unavailable — waiting for updater:", err);
    // Re-attempt after an in-place update (hot swap) AND on a short timer: if
    // the updater's reload is suppressed (the reload guard) or the swap events
    // never fire, the shell must still self-heal once the data dir populates.
    // Stops on the first success or after ~3 minutes.
    let timer: number | undefined;
    let attempts = 0;
    const done = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      appEvents.off(AppEvent.SWUpdateReady, attempt);
      appEvents.off(AppEvent.ModulesSwapped, attempt);
    };
    const attempt = (): void => {
      registerLazy(app, true)
        .then(done)
        .catch(() => {
          attempts += 1;
          if (attempts >= 18) done();
        });
    };
    appEvents.on(AppEvent.SWUpdateReady, attempt);
    appEvents.on(AppEvent.ModulesSwapped, attempt);
    timer = window.setInterval(attempt, 10_000);
  }
}

async function init() {
  setSessionStarted(Date.now());

  // Wire the native bridge BEFORE the provider boot: initializeProvider (Part A)
  // synchronously calls through the bridge (getContentRoot / getTree) on
  // GuiMobile, and the Android bridge exists only once initMobileBridge() has
  // mirrored NativeBridge onto window.saucer.exposed. Run this below the boot
  // and every startup logs "Native bridge function getTree is unavailable".
  initNativeBridge();

  setProviderReady(initializeProvider());

  if (thinShell) {
    registerCoreControllers(app);
  } else {
    // The single-stage registration entry is generated per build mode from
    // templates/partials/register.eta (src/eta/register.ts); non-thin builds
    // register core synchronously and load the lazy controllers through a
    // dynamic import so Farm resolves the lazy pot via its async loader.
    const { registerControllers } = await import("@/eta/register");
    await registerControllers(app);
  }

  await app.start();

  if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
    const { registerSW } = await import("./services/sw-registrar-service");
    registerSW(registry);
  }

  // Fetch transport (Part C.1): self-gates on the SW being absent (non-http(s)
  // origin), UPDATE_BASE set, and a non-dev build — see startUpdater. This must
  // start BEFORE the lazy registration below: on a thin shell's first run the
  // lazy chunks exist nowhere on disk yet, and the updater is what downloads
  // them (then reloads). Starting it first means the one-time import failure
  // below can't strand the shell.
  const { startUpdater } = await import("./services/updater-service");
  startUpdater(registry);

  if (thinShell) {
    await registerLazy(app);
  }
}

init();
