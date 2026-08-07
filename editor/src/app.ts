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
import { hasFunc, AppFunc } from "$/build/build-mode";

initFarmCompat(editorSelfBase + "assets/");

const app = new Application();

// Part D two-stage entry. app.ts must never statically import
// controllers/index (its registerControllers pulls controllers/lazy → editor →
// node_imports, which would keep every @milkdown/* in the eager boot set). The
// eager graph ends at controllers/core; the editor + dialog controllers are
// always reached through a dynamic import.
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

// Part D lazy registration for thin shells. The editor + dialog controllers
// live in lazy chunks that are never in the shipped dist/; on a thin shell's
// FIRST run the fetch updater hasn't populated the data dir yet, so the dynamic
// import fails here — and that must never abort boot, or startUpdater never
// runs and the shell stays broken. The updater's transfer + reload boots a
// complete editor from the data-dir copy (the scheme serves it first); if it
// instead applies in place (hot swap), retry once after the swap so the editor
// still wires up.
async function registerLazy(app: Application, retried = false): Promise<void> {
  try {
    const { registerLazyControllers } = await import("@/controllers/lazy");
    registerLazyControllers(app);
  } catch (err) {
    if (retried) return;
    console.warn("[boot] lazy controllers unavailable — waiting for updater:", err);
    const retry = (): void => {
      void registerLazy(app, true).catch((e) =>
        console.warn("[boot] lazy controllers still unavailable after update:", e)
      );
    };
    appEvents.on(AppEvent.SWUpdateReady, retry);
    appEvents.on(AppEvent.ModulesSwapped, retry);
  }
}

async function init() {
  setSessionStarted(Date.now());

  setProviderReady(initializeProvider());

  if (thinShell) {
    registerCoreControllers(app);
  } else {
    const { registerControllers } = await import("@/controllers/index");
    registerControllers(app);
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
