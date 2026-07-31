import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import renderNoFile from "@/eta/views/controller/no-file"

export interface NoFileViewData {
  isEmpty: boolean
  recents: string[]
  suggestions: string[]
}

export default class extends Controller {
  load(opts: NoFileViewData): void {
    this.element.innerHTML = renderNoFile(opts as unknown as Record<string, unknown>)
  }

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
