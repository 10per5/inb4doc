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
  private insertMenu: Menu | null = null

  connect(): void {
    // Render only into the nav slot — #dock also hosts the edit-toolbar strip,
    // so it must not be clobbered with innerHTML.
    this.navTarget.innerHTML = renderDock({ icons: icons as Record<string, string> })
    this.insertMenu = new Menu({
      mountEl: this.fabMenuTarget,
      triggerEl: this.fabItem,
      label: "Add",
      items: () => menuRegistry.get("add-block")!,
      panelClass: "dock-fab-menu",
    })
    this.unsubs.push(
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.currentView = view
        this.insertMenu?.close()
        dockStore.setActive(viewToDockItem(view))
      }),
      dockStore.subscribe((item) => this.setActiveItem(item)),
    )
    this.setActiveItem(dockStore.getActive())
  }

  disconnect(): void {
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.insertMenu?.destroy()
    this.insertMenu = null
  }

  activate(event: Event): void {
    event.stopPropagation()
    const item = ((event.currentTarget as HTMLElement).dataset.dockItem ?? "editor") as DockItem
    if (item === "editor") {
      // Already on the editor view → the FAB is the insert-block "+" popup
      // trigger. Otherwise it's the tab that returns to the editor.
      if (this.currentView === "editor") {
        if (this.insertMenu?.isOpen) {
          this.insertMenu.close()
        } else {
          this.insertMenu?.openAndFocusFirst()
        }
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
    return (
      this.element.querySelector<HTMLElement>('[data-dock-item="editor"]') ??
      this.itemTargets.find((el) => el.dataset.dockItem === "editor")!
    )
  }

  private setActiveItem(item: DockItem): void {
    const fab = this.fabItem
    if (fab && this.insertMenu) {
      this.insertMenu.setTriggerEl(fab)
    }
    for (const el of this.itemTargets) {
      const active = el.dataset.dockItem === item
      el.classList.toggle("is-active", active)
      el.setAttribute("aria-selected", active ? "true" : "false")
    }
    this.setFabState(item === "editor")
  }

  // Editor view → "+" (insert menu trigger); any other view → pencil + "Editor"
  // label (return-to-editor tab). Toggled via data-dock-state on the FAB.
  private setFabState(editorView: boolean): void {
    const fab = this.fabItem
    fab.dataset.dockState = editorView ? "add" : "editor"
    fab.setAttribute("aria-label", editorView ? "Add block" : "Editor")
    fab.setAttribute("title", editorView ? "Add block" : "Editor")
    const plus = fab.querySelector(".dock-icon--plus") as HTMLElement | null
    const pencil = fab.querySelector(".dock-icon--pencil") as HTMLElement | null
    const label = fab.querySelector(".dock-label") as HTMLElement | null
    if (plus) plus.hidden = !editorView
    if (pencil) pencil.hidden = editorView
    if (label) label.hidden = editorView
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
