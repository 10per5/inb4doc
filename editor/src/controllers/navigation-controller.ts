import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import * as icons from "@/eta/icons"
import { renderScreen } from "@/eta/views/screen"
import renderNavigation from "@/eta/views/controller/navigation"

export default class NavigationController extends Controller {
  connect(): void {
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderNavigation({ icons: icons as Record<string, string>, renderScreen })
    // The nested sidebar (data-controller="sidebar") connects on the next tick
    // and renders only when a SidebarReload arrives. On mobile this screen is
    // created at boot, before the first SidebarReload — but on desktop/tablet it
    // is created lazily, after the tree is already loaded, so nothing would ever
    // populate it. Prime it once here (idempotent on mobile).
    requestAnimationFrame(() => {
      appEvents.emit(AppEvent.SidebarReload)
    })
  }

  close(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
  }
}
