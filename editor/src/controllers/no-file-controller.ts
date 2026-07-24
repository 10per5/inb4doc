import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"

export default class extends Controller {
  open(event: Event): void {
    const path = (event.currentTarget as HTMLElement).dataset.filePath
    if (path) appEvents.emit(AppEvent.Navigate, { path })
  }

  createPage(): void {
    appEvents.emit(AppEvent.CreateFirstPage)
  }

  changeProvider(): void {
    appEvents.emit(AppEvent.ProviderChangeRequested)
  }
}
