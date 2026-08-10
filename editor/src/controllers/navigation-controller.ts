import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import * as icons from "@/eta/icons"
import { renderScreen } from "@/eta/views/screen"
import renderNavigation from "@/eta/views/controller/navigation"

export default class NavigationController extends Controller {
  connect(): void {
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderNavigation({ icons: icons as Record<string, string>, renderScreen })
  }

  close(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
  }
}
