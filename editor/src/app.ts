import "./styles/index";

import { Application } from "@hotwired/stimulus";
import { registerCoreControllers } from "@/controllers/core";
import { ModuleRegistry } from "@/services/module-registry";
import { setRegistry } from "@/services/registry-provider";
import { initializeProvider, setProviderReady } from "@/stores/provider-store";
import { appEvents, AppEvent } from "@/stores/app-events";
import { initNativeBridge } from "@/eta/bridge";
import { setSessionStarted } from "@/controllers/shell_controller";
import { initFarmCompat } from "$/farmfe-compat";
import { editorSelfBase } from "@/config";
import { logger } from "@/utils/logger";
import { hasFunc, AppFunc } from "$/build/build-mode";

initFarmCompat(editorSelfBase + "assets/");

const app = new Application();

// Part D two-stage entry. app.ts must never statically import the single-stage
// registration glue (its registerControllers pulls controllers/lazy → editor →
// node_imports, which would keep every @milkdown/* in the eager boot set). The
// eager graph ends at controllers/core; the editor + dialog controllers are
// always reached through a dynamic import. The glue itself is generated per
// build mode (templates/partials/register.eta → src/eta/register.ts): non-thin
// builds get the registerControllers used below, thin shells get a no-op.
//
// Thin shells (ThinShell — GuiDesktop) register core synchronously, start, then
// register the lazy controllers so node_imports leaves the shipped boot set and
// the first-run updater downloads it. Web keeps the equivalent behavior through
// a dynamic registerControllers before start. Stimulus connects lazily-
// registered controllers for elements already in the DOM (the scope observer
// records data-controller scopes at start regardless of registration), so the
// editor outlet wires up once the lazy chunk arrives.
//
// Invariants for the split: core controller modules must not VALUE-import
// editor-controller, any dialog controller, or @milkdown/* (type-only imports
// are erased); interactive dialog opening goes through dynamic imports in the
// handlers.
const thinShell = hasFunc(AppFunc.ThinShell);

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

  initNativeBridge();

  if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
    const { registerSW } = await import("./services/sw-registrar");
    registerSW(registry);
  }

  // Fetch transport (Part C.1): self-gates on the SW being absent (non-http(s)
  // origin), UPDATE_BASE set, and a non-dev build — see startUpdater. This must
  // start BEFORE the lazy registration below: on a thin shell's first run the
  // lazy chunks exist nowhere on disk yet, and the updater is what downloads
  // them (then reloads). Starting it first means the one-time import failure
  // below can't strand the shell.
  const { startUpdater } = await import("./services/updater");
  startUpdater(registry);

  if (thinShell) {
    await registerLazy(app);
  }
}

init();
