import "./styles/index";

import { Application } from "@hotwired/stimulus";
import { registerControllers } from "@/controllers/index";
import { ModuleRegistry } from "@/services/module-registry";
import { setRegistry } from "@/services/registry-provider";
import { initializeProvider, setProviderReady } from "@/stores/provider-store";
import { initBridge } from "@/bridge/index";
import { setSessionStarted } from "@/controllers/shell_controller";
import { initFarmCompat } from "$/farmfe-compat";
import { editorSelfBase } from "@/config";

initFarmCompat(editorSelfBase + "assets/");

const app = new Application();
registerControllers(app);
const registry = new ModuleRegistry(app);
setRegistry(registry);

async function init() {
  setSessionStarted(Date.now());

  setProviderReady(initializeProvider());

  await app.start();
  initBridge();

  if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
    const { registerSW } = await import("./services/sw-registrar");
    registerSW(registry);
  }
}

init();
