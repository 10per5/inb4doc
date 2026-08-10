import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { PendingOps } from "@/entities/PendingOps"
import { pendingOpsStore } from "@/stores/pending-ops-store"
import * as icons from "@/eta/icons"
import { renderScreen } from "@/eta/views/screen"
import renderMore from "@/eta/views/controller/more"

export default class MoreController extends Controller {
  connect(): void {
    if (this.element.querySelector(".screen")) return
    this.load()
  }

  /** Called by the view controller on each activation (fresh pending count). */
  load(): void {
    const pendingCount = new PendingOps(pendingOpsStore.load()).count
    this.element.innerHTML = renderMore({
      icons: icons as Record<string, string>,
      renderScreen,
      pendingCount,
    })
  }

  close(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
  }

  openChanges(): void {
    appEvents.emit(AppEvent.DirtyClicked)
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
