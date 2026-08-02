import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { github } from "@/eta/icons"
import { pagesStore } from "@/stores/page-store"
import { getCurrentPath } from "@/utils/url"
import { MetaPanelUI } from "./meta-panel"
import renderMetaPanel from "@/eta/views/controller/meta-panel"
import type { EditorController } from "@/controllers/editor-controller"

const OUTLINE_REFRESH_DELAY = 150

export default class extends Controller {
  static targets = ["outline", "outlineSection"]
  static outlets = ["editor"]

  declare readonly outlineTarget: HTMLElement
  declare readonly outlineSectionTarget: HTMLElement
  declare readonly editorOutlet: EditorController | null

  private ui: MetaPanelUI | null = null
  private unsubs: (() => void)[] = []
  private outlineTimer: ReturnType<typeof setTimeout> | null = null

  connect() {
    this.unsubs.push(
      appEvents.on(AppEvent.MetaPanelReload, () => {
        this.load()
      }),
      appEvents.on(AppEvent.OutlineChanged, () => {
        this.scheduleOutlineUpdate()
      }),
      appEvents.on(AppEvent.EditorChanged, () => {
        this.scheduleOutlineUpdate()
      }),
      appEvents.on(AppEvent.SourceModeToggled, () => {
        this.scheduleOutlineUpdate()
      })
    )
    this.load()
  }

  disconnect() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    if (this.outlineTimer) clearTimeout(this.outlineTimer)
  }

  editorOutletConnected() {
    if (!this.element.querySelector(".meta-outline")) return
    this.renderOutline()
  }

  editorOutletDisconnected() {
    if (!this.element.querySelector(".meta-outline-section")) return
    this.outlineSectionTarget.hidden = true
  }

  load(): void {
    this.element.innerHTML = renderMetaPanel({ github })
    this.ui = new MetaPanelUI(this.element as HTMLElement, () => this.notify())
    const data = pagesStore.get(getCurrentPath())?.getFrontmatter()
    this.ui.update(data ?? { title: "" })
    this.renderOutline()
  }

  addField() {
    this.ui?.addRow("", "", true)
  }

  inputChanged() {
    this.notify()
  }

  onOutlineClick(event: MouseEvent): void {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      ".meta-outline-item"
    )
    if (!item) return
    const pos = Number(item.dataset.pos)
    if (Number.isNaN(pos)) return
    this.editorOutlet?.scrollToHeading(pos)
  }

  private scheduleOutlineUpdate(): void {
    if (this.outlineTimer) clearTimeout(this.outlineTimer)
    this.outlineTimer = setTimeout(() => {
      this.outlineTimer = null
      this.renderOutline()
    }, OUTLINE_REFRESH_DELAY)
  }

  private renderOutline(): void {
    const outline = this.editorOutlet?.getOutline() ?? []
    this.outlineSectionTarget.hidden = outline.length === 0
    this.outlineTarget.innerHTML = outline
      .map(
        (item) =>
          `<button type="button" class="meta-outline-item" data-pos="${item.pos}" style="--outline-level: ${item.level}">` +
          `${escapeHtml(item.text)}</button>`
      )
      .join("")
  }

  private notify() {
    if (!this.ui) return
    appEvents.emit(AppEvent.MetaDataChanged, { data: this.ui.collect() })
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
