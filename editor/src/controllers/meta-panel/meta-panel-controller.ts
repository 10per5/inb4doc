import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { github } from "@/eta/icons"
import { pagesStore } from "@/stores/page-store"
import { getCurrentPath } from "@/utils/url"
import { MetaPanelUI } from "./meta-panel"
import renderMetaPanel from "@/eta/views/controller/meta-panel"

export default class extends Controller {
  private ui: MetaPanelUI | null = null
  private unsubs: (() => void)[] = []

  connect() {
    this.unsubs.push(
      appEvents.on(AppEvent.MetaPanelReload, () => {
        this.load()
      })
    )
    this.load()
  }

  disconnect() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
  }

  load(): void {
    this.element.innerHTML = renderMetaPanel({ github })
    this.ui = new MetaPanelUI(this.element as HTMLElement, () => this.notify())
    const data = pagesStore.get(getCurrentPath())?.getFrontmatter()
    this.ui.update(data ?? { title: "" })
  }

  addField() {
    this.ui?.addRow("", "", true)
  }

  inputChanged() {
    this.notify()
  }

  private notify() {
    if (!this.ui) return
    appEvents.emit(AppEvent.MetaDataChanged, { data: this.ui.collect() })
  }
}
