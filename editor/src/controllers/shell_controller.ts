import { Controller } from "@hotwired/stimulus"
import { AppController } from "@/controllers/app-controller"
import { getCurrentPath } from "@/utils/url"

export default class extends Controller {
  private app!: AppController

  async connect() {
    const initialPath = this.data.get("path") || getCurrentPath()
    this.app = new AppController({ initialPath })
    await this.app.initialize()
  }

  disconnect() {
    this.app?.destroy()
  }

  toggleSource = () => this.app.editor.toggleSourceMode()
  applySource  = () => this.app.editor.applySourceContent()
  flush        = () => this.app.cache.flushDirtyFiles()
}
