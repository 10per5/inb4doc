import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { dockStore, type DockItem } from "@/stores/dock-store"
import * as icons from "@/eta/icons"
import renderDock from "@/eta/views/controller/dock"
import { trackKeyboardOffset } from "@/utils/mobile"
import type { ViewType } from "@/services/view-service"

/**
 * Mobile bottom dock — two tabs: Files, Editor.
 *
 * The middle tab used to double as an "add block" FAB and the third one opened
 * a "More" screen; both are gone. Everything they reached lives in the File ▸
 * dropdown in the topbar (View ▸ and More ▸ submenus), so insert-block stays
 * in exactly one place (the edit-toolbar's "+") and secondary screens keep one
 * consistent entry point. The pending-changes badge moved to Files, since that
 * is the screen that now carries the review/save row for them.
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
    appEvents.emit(AppEvent.ViewChanged, { view: item === "navigation" ? "navigation" : "editor" })
  }

  private setActiveItem(item: DockItem): void {
    for (const el of this.itemTargets) {
      const active = el.dataset.dockItem === item
      el.classList.toggle("is-active", active)
      el.setAttribute("aria-selected", active ? "true" : "false")
    }
  }
}

/**
 * With the More screen gone the dock is two tabs, so every fullview that is
 * not the file explorer simply highlights nothing — those screens are reached
 * from the File ▸ View / More menus and step back to the editor themselves.
 */
function viewToDockItem(view: ViewType): DockItem {
  switch (view) {
    case "navigation":
      return "navigation"
    case "editor":
      return "editor"
    default:
      return "other"
  }
}
