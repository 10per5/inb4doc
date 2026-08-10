import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import * as icons from "@/eta/icons"
import { renderScreen } from "@/eta/views/screen"
import renderMore from "@/eta/views/controller/more"

export default class MoreController extends Controller {
  connect(): void {
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderMore({ icons: icons as Record<string, string>, renderScreen })
  }

  close(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
  }

  openDiskUsage(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "disk-usage" })
  }

  openMeta(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "meta" })
  }

  openPrefs(): void {
    appEvents.emit(AppEvent.PrefsOpened)
  }

  openImageManager(): void {
    appEvents.emit(AppEvent.ImageManagerOpened)
  }
}
