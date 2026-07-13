import { Controller } from "@hotwired/stimulus"
import { AppController } from "@/controllers/app-controller"
import { getCurrentPath } from "@/utils/url"
import { hideLoadingOverlay } from "@/components/overlay/loading-overlay"

export default class extends Controller {
  private app!: AppController

  async connect() {
    const initialPath = this.data.get("path") || getCurrentPath()
    this.app = new AppController({ initialPath })
    try {
      await this.app.initialize()
    } finally {
      hideLoadingOverlay()
    }
  }

  disconnect() {
    this.app?.destroy()
  }

  toggleSource = () => this.app.editor.toggleSourceMode()
  applySource  = () => this.app.editor.applySourceContent()
  flush        = () => this.app.cache.flushDirtyFiles()
}
