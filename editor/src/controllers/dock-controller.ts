import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { dockStore, type DockItem } from "@/stores/dock-store"
import * as icons from "@/eta/icons"
import renderDock from "@/eta/views/controller/dock"
import { trackKeyboardOffset } from "@/utils/mobile"
import type { ViewType } from "@/services/view-service"

/**
 * Mobile bottom dock — three tabs: Files, Editor, More.
 *
 * The middle tab used to double as an "add block" FAB, which put a second "+"
 * on the same screen the edit-toolbar strip already carried one on. It is now
 * a plain editor toggle (the way back to the editor from any fullview), so
 * insert-block lives in exactly one place: the edit-toolbar's "+" menu.
 */
export default class DockController extends Controller {
  static targets = ["item", "nav", "badge"]

  declare readonly itemTargets: HTMLElement[]
  declare readonly navTarget: HTMLElement
  declare readonly badgeTarget: HTMLElement
  declare readonly hasBadgeTarget: boolean

  private currentView: ViewType = "editor"
  private unsubs: (() => void)[] = []
  private stopKeyboardTrack: (() => void) | null = null

  connect(): void {
    // Render only into the nav slot — #dock also hosts the edit-toolbar strip,
    // so it must not be clobbered with innerHTML.
    this.navTarget.innerHTML = renderDock({ icons: icons as Record<string, string> })
    this.unsubs.push(
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.currentView = view
        dockStore.setActive(viewToDockItem(view))
      }),
      dockStore.subscribe((item) => this.setActiveItem(item)),
      appEvents.on(AppEvent.DirtyChanged, ({ count }) => {
        if (!this.hasBadgeTarget) return
        this.badgeTarget.textContent = String(count)
        this.badgeTarget.hidden = count === 0
      }),
    )
    // Publish the on-screen keyboard height so the layout trims the scroll
    // container instead of hiding chrome.
    this.stopKeyboardTrack = trackKeyboardOffset((offset) => {
      const el = this.element as HTMLElement
      el.classList.toggle("kb-open", offset > 0)
      el.style.setProperty("--kb-offset", `${offset}px`)
    })
    this.setActiveItem(dockStore.getActive())
  }

  disconnect(): void {
    this.stopKeyboardTrack?.()
    this.stopKeyboardTrack = null
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
  }

  activate(event: Event): void {
    event.stopPropagation()
    const item = ((event.currentTarget as HTMLElement).dataset.dockItem ?? "editor") as DockItem
    // Already on the editor tab — nothing to toggle back to.
    if (item === "editor" && viewToDockItem(this.currentView) === "editor") return
    appEvents.emit(AppEvent.ViewChanged, { view: item })
  }

  private setActiveItem(item: DockItem): void {
    for (const el of this.itemTargets) {
      const active = el.dataset.dockItem === item
      el.classList.toggle("is-active", active)
      el.setAttribute("aria-selected", active ? "true" : "false")
    }
  }
}

function viewToDockItem(view: ViewType): DockItem {
  switch (view) {
    case "navigation":
      return "navigation"
    case "more":
    case "meta":
    case "disk-usage":
    case "prefs":
    case "about":
    case "images":
    case "changes":
      return "more"
    default:
      return "editor"
  }
}
