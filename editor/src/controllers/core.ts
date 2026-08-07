import { Application, type Controller } from "@hotwired/stimulus"
import { hasFunc, AppFunc } from "$/build/build-mode"

import ShellController from "./shell_controller"
import TopbarController from "./topbar-controller"
import SidebarController from "./sidebar/sidebar-controller"
import ContextMenuController from "./context-menu-controller"
import { PressTwiceController } from "./press-twice-controller"
import NoFileController from "./no-file-controller"
import DirIndexEmptyController from "./dir-index-empty-controller"
import DiskUsageController from "./disk-usage-controller"
import UpdateController from "./update-controller"
import UpdaterLoaderController from "./updater-loader-controller"
import MetaPanelController from "./meta-panel/meta-panel-controller"

export interface ControllerRegistration {
  name: string
  controller: new (...args: any[]) => Controller
}

// Part D two-stage entry: the FastStartup build registers exactly these
// controllers synchronously (their value-import graph must never reach
// editor-controller, the dialog controllers, or @milkdown/* — see core/lazy
// split invariants in app.ts). Everything interactive is a lazy chunk.
const coreRegistrations: ControllerRegistration[] = [
  { name: "shell", controller: ShellController },
  { name: "topbar", controller: TopbarController },
  { name: "sidebar", controller: SidebarController },
  { name: "press-twice", controller: PressTwiceController },
  { name: "context-menu", controller: ContextMenuController },
  { name: "no-file", controller: NoFileController },
  { name: "dir-index-empty", controller: DirIndexEmptyController },
  { name: "disk-usage", controller: DiskUsageController },
  { name: "meta-panel", controller: MetaPanelController },
  { name: "update", controller: UpdateController },
]

export function registerCoreControllers(app: Application): void {
  for (const { name, controller } of coreRegistrations) {
    app.register(name, controller)
  }
  // Thin-shell first-run loader. Registered only for thin builds — the mount
  // element (shell.eta) only exists there, so web builds never see it; the
  // hasFunc gate keeps the eager boot set free of the loader's event wiring.
  if (hasFunc(AppFunc.ThinShell)) {
    app.register("updater-loader", UpdaterLoaderController)
  }
}
