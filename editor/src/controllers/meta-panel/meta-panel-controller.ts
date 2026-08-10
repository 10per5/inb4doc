import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import * as icons from "@/eta/icons"
import { isMobileDock } from "@/utils/mobile"
import { LayoutService } from "@/services/layout-service"
import { pagesStore } from "@/stores/page-store"
import { getCurrentPath } from "@/utils/url"
import { MetaPanelUI } from "./meta-panel"
import { renderScreen } from "@/eta/views/screen"
import renderMetaPanel from "@/eta/views/controller/meta-panel"
import type { EditorController } from "@/controllers/editor-controller"

const OUTLINE_REFRESH_DELAY = 150

export default class extends Controller {
  static targets = ["outline", "outlineSection"]
  static outlets = ["editor"]

  declare readonly outlineTarget: HTMLElement
  declare readonly outlineSectionTarget: HTMLElement
  declare readonly editorOutletElement: Element
  declare readonly hasEditorOutlet: boolean

  // editorOutlet is a blessed Stimulus getter that THROWS when the outlet
  // element lacks a connected "editor" controller instance — which is the case
  // on thin shells before the lazy editor chunk registers (first GUI run, and
  // every boot until registerLazy completes). Route every access through this
  // so connect()/renderOutline never throw on that window; the outlet callback
  // re-renders the outline once the editor actually connects.
  private editor(): EditorController | null {
    if (!this.hasEditorOutlet) return null
    return this.application.getControllerForElementAndIdentifier(
      this.editorOutletElement,
      "editor"
    ) as EditorController | null
  }

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
    const mobile = isMobileDock()
    this.element.innerHTML = renderMetaPanel({
      icons: icons as Record<string, string>,
      github: icons.github,
      renderScreen,
      backIcon: mobile ? "back" : "xmark",
      backLabel: mobile ? "Back to more" : "Close meta panel",
    })
    this.ui = new MetaPanelUI(this.element as HTMLElement, () => this.notify())
    const data = pagesStore.get(getCurrentPath())?.getFrontmatter()
    this.ui.update(data ?? { title: "" })
    this.renderOutline()
  }

  close(): void {
    if (isMobileDock()) {
      appEvents.emit(AppEvent.ViewChanged, { view: "more" })
    } else {
      // Desktop: closes the aside column; tablet (meta screen): toggles the
      // panel off, which returns the center view to the editor.
      LayoutService.getInstance().setMeta(false)
    }
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
    const level = Number(item.dataset.level)
    const text = decodeURIComponent(item.dataset.text ?? "")
    const scroll = () =>
      this.editor()?.scrollToHeading(
        text,
        level,
        Number.isNaN(pos) ? undefined : pos
      )
    // Full-screen meta panel (tablet center screen / mobile "more" screen): the
    // editor is hidden beneath it. Leave the screen first, then scroll once the
    // editor is visible again.
    if (this.element.classList.contains("fullview-view")) {
      if (isMobileDock()) {
        appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
      } else {
        LayoutService.getInstance().setMeta(false)
      }
      requestAnimationFrame(() => requestAnimationFrame(() => scroll()))
      return
    }
    scroll()
  }

  private scheduleOutlineUpdate(): void {
    if (this.outlineTimer) clearTimeout(this.outlineTimer)
    this.outlineTimer = setTimeout(() => {
      this.outlineTimer = null
      this.renderOutline()
    }, OUTLINE_REFRESH_DELAY)
  }

  private renderOutline(): void {
    if (!this.element.querySelector(".meta-outline-section")) return
    const outline = this.editor()?.getOutline() ?? []
    this.outlineSectionTarget.hidden = outline.length === 0
    this.outlineTarget.innerHTML = outline
      .map(
        (item) =>
          `<button type="button" class="meta-outline-item" data-pos="${item.pos}" data-level="${item.level}" data-text="${encodeURIComponent(item.text)}" style="--outline-level: ${item.level}">` +
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
