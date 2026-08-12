import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { dockStore, type DockItem } from "@/stores/dock-store"
import * as icons from "@/eta/icons"
import renderDock from "@/eta/views/controller/dock"
import { Menu } from "@/components/ui/menu"
import { menuRegistry } from "@/config/menu-definitions"
import { trackKeyboardOffset } from "@/utils/mobile"
import type { ViewType } from "@/services/view-controller"
import type { EditorController } from "@/controllers/editor-controller"

export default class DockController extends Controller {
  static targets = ["item", "nav", "fabMenu"]
  static outlets = ["editor"]

  declare readonly itemTargets: HTMLElement[]
  declare readonly navTarget: HTMLElement
  declare readonly fabMenuTarget: HTMLElement
  declare readonly editorOutletElement: Element
  declare readonly hasEditorOutlet: boolean

  private currentView: ViewType = "editor"
  private unsubs: (() => void)[] = []
  private stopKeyboardTrack: (() => void) | null = null
  private insertMenu: Menu | null = null
  private kbOpen = false

  connect(): void {
    // Render only into the nav slot — #dock also hosts the edit-toolbar
    // popover anchor, so it must not be clobbered with innerHTML.
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
    // Relocate the FAB above the on-screen keyboard when it opens. If the
    // insert menu is open, re-anchor it too: open keyboard → follow the
    // selection block; closed → back to the dock strip.
    this.stopKeyboardTrack = trackKeyboardOffset((offset) => {
      const el = this.element as HTMLElement
      const kb = offset > 0
      this.kbOpen = kb
      el.classList.toggle("kb-open", kb)
      el.style.setProperty("--kb-offset", `${offset}px`)
      if (this.insertMenu?.isOpen) {
        this.anchorFabMenu().then(() => this.insertMenu?.reposition())
      }
    })
    this.setActiveItem(dockStore.getActive())
  }

  disconnect(): void {
    this.stopKeyboardTrack?.()
    this.stopKeyboardTrack = null
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.insertMenu?.destroy()
    this.insertMenu = null
  }

  activate(event: Event): void {
    event.stopPropagation()
    const item = ((event.currentTarget as HTMLElement).dataset.dockItem ?? "editor") as DockItem
    if (item === "editor") {
      // FAB is the insert-block "+" popup trigger when on the editor tab
      // (editor, no-file, dir-index-empty). On other fullviews (navigation,
      // more, meta), it acts as the return-to-editor tab.
      const isEditorTab = viewToDockItem(this.currentView) === "editor"
      if (isEditorTab) {
        if (this.insertMenu?.isOpen) {
          this.insertMenu.close()
        } else {
          this.anchorFabMenu().then(() => this.insertMenu?.openAndFocusFirst())
        }
        return
      }
      appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: item })
  }

  // Keyboard open → anchor the insert popup at the selected block (above-first
  // flip). Keyboard closed → reset to the mount element (the dock strip), which
  // keeps today's open-upward, right-aligned behavior.
  private async anchorFabMenu(): Promise<void> {
    const anchor = this.fabMenuTarget
    if (!this.kbOpen) {
      anchor.classList.remove("is-block-anchored")
      anchor.style.left = ""
      anchor.style.top = ""
      this.insertMenu?.setAnchorRect(null)
      return
    }
    const milk = this.editor()?.getEditor()
    if (!milk) return
    const { getView } = await import("@/services/editor-context")
    const view = getView(milk)
    const coords = view.coordsAtPos(view.state.selection.from)
    if (!coords) return
    anchor.classList.add("is-block-anchored")
    anchor.style.left = `${coords.left}px`
    anchor.style.top = `${coords.top}px`
    this.insertMenu?.setAnchorRect(coords, true)
  }

  // editorOutlet is a blessed Stimulus getter that THROWS when the outlet
  // element lacks a connected "editor" controller — which is the case on thin
  // shells before the lazy editor chunk registers. Route every access through
  // this so activate() never throws on that window.
  private editor(): EditorController | null {
    if (!this.hasEditorOutlet) return null
    return this.application.getControllerForElementAndIdentifier(
      this.editorOutletElement,
      "editor",
    ) as EditorController | null
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
    case "prefs":
    case "images":
    case "changes":
      return "more"
    default:
      return "editor"
  }
}
