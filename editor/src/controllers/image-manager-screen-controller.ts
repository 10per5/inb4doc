import { Controller } from "@hotwired/stimulus"
import * as icons from "@/eta/icons"
import { appEvents, AppEvent } from "@/stores/app-events"
import { renderScreen } from "@/eta/views/screen"
import { loadImageManagerData, bindImageManagerActions } from "@/components/ui/image-manager"
import renderImageManagerRows from "@/eta/views/image-manager-rows"
import renderImageManagerScreen from "@/eta/views/controller/image-manager-screen"

export default class ImageManagerScreenController extends Controller {
  close(): void {
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  /** Called by the view controller when the screen is activated (provider ready). */
  async load(): Promise<void> {
    const data = await loadImageManagerData()
    this.element.innerHTML = renderImageManagerScreen({
      icons: icons as Record<string, string>,
      renderScreen,
      rows: renderImageManagerRows(data as unknown as Record<string, unknown>),
    })
    bindImageManagerActions(this.element as HTMLElement, {
      onAllImagesDeleted: () => appEvents.emit(AppEvent.ViewChanged, { view: "more" }),
    })
  }
}
