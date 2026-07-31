import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import renderDirIndexEmpty from "@/eta/views/controller/dir-index-empty"

export default class DirIndexEmptyController extends Controller {
  private path: string = ""

  load(opts: { path: string }): void {
    this.path = opts.path
    this.element.innerHTML = renderDirIndexEmpty({})
  }

  activate(): void {
    appEvents.emit(AppEvent.DirIndexActivated, { path: this.path })
  }
}
