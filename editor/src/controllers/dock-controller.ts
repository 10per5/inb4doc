import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { dockStore, type DockItem } from "@/stores/dock-store"
import * as icons from "@/eta/icons"
import renderDock from "@/eta/views/controller/dock"
import { Menu } from "@/components/ui/menu"
import { menuRegistry } from "@/config/menu-definitions"
import type { ViewType } from "@/services/view-controller"

export default class DockController extends Controller {
  static targets = ["item", "nav", "fabMenu"]

  declare readonly itemTargets: HTMLElement[]
  declare readonly navTarget: HTMLElement
  declare readonly fabMenuTarget: HTMLElement

  private currentView: ViewType = "editor"
  private unsubs: (() => void)[] = []
  private editMenu: Menu | null = null

  connect(): void {
    // Render only into the nav slot — #dock also hosts the edit-toolbar strip,
    // so it must not be clobbered with innerHTML.
    this.navTarget.innerHTML = renderDock({ icons: icons as Record<string, string> })
    this.editMenu = new Menu({
      mountEl: this.fabMenuTarget,
      triggerEl: this.fabItem,
      label: "Edit",
      items: () => menuRegistry.get("format-more")!,
      panelClass: "toolbar-menu--up",
    })
    this.unsubs.push(
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.currentView = view
        this.editMenu?.close()
        dockStore.setActive(viewToDockItem(view))
      }),
      dockStore.subscribe((item) => this.setActiveItem(item)),
    )
    this.setActiveItem(dockStore.getActive())
  }

  disconnect(): void {
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.editMenu?.destroy()
    this.editMenu = null
  }

  activate(event: Event): void {
    const item = ((event.currentTarget as HTMLElement).dataset.dockItem ?? "editor") as DockItem
    if (item === "editor") {
      // Already on the editor view → the FAB is a popup trigger for the
      // formatting menu. Otherwise it's the tab that returns to the editor.
      if (this.currentView === "editor") {
        this.editMenu?.toggle()
        return
      }
      const view: ViewType = (this.currentView === "no-file" || this.currentView === "dir-index-empty")
        ? this.currentView
        : "editor"
      appEvents.emit(AppEvent.ViewChanged, { view })
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: item })
  }

  private get fabItem(): HTMLElement {
    return this.itemTargets.find((el) => el.dataset.dockItem === "editor")!
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
      return "more"
    default:
      return "editor"
  }
}
