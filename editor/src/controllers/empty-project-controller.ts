import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"

export default class extends Controller {
  createPage(): void {
    appEvents.emit(AppEvent.CreateFirstPage)
  }

  changeProvider(): void {
    appEvents.emit(AppEvent.ProviderChangeRequested)
  }
}
