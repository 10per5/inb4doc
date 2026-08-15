import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import { ActiveBlockType, type ActiveBlockContext } from "@/config/enums/block-context"
import * as icons from "@/eta/icons"
import renderEditToolbar from "@/eta/views/controller/edit-toolbar"
import { Menu } from "@/components/ui/menu"
import { menuRegistry } from "@/config/menu-definitions"
import { trackKeyboardOffset, isMobileViewport, isTabletViewport, isMobileOrTabletUA } from "@/utils/mobile"
import { applyPanelFlip, getBlockRectAt, type FlipAnchorRect } from "@/utils/popover"
import type { EditorController } from "@/controllers/editor-controller"

/**
 * Quick bar for the mobile dock. Two modes:
 * - Default (keyboard closed): a strip pinned at the bottom of the dock.
 * - Follow mode (keyboard open): a popover anchored at the block the caret is
 *   in, so the actions stay next to where you type. The `.is-follow-mode`
 *   class on #edit-toolbar switches the CSS; this controller positions the
 *   0×0 fixed anchor via applyPanelFlip and hides the popover once the block
 *   scrolls out of the viewport — or once it has nothing useful to offer
 *   (undo disabled AND no contextual list/table actions; a lone enabled redo
 *   does not count, e.g. right after pressing undo).
 * Undo/redo are always shown in both modes (disabled when the open file has
 * no history); the list/table groups appear contextually inside the bar.
 * A "+" FAB button on the strip opens the shared add-block menu in every mode
 * (the dock FAB is hidden at tablet widths). While that menu is open the strip
 * hides so the two never overlap.
 */
export default class EditToolbarController extends Controller {
  static targets = ["btn", "listGroup", "tableGroup", "addGroup", "addBtn", "fabMenu"]
  static outlets = ["editor"]

  declare readonly btnTargets: HTMLElement[]
  declare readonly listGroupTarget: HTMLElement
  declare readonly tableGroupTarget: HTMLElement
  declare readonly addGroupTarget: HTMLElement
  declare readonly addBtnTarget: HTMLElement
  declare readonly fabMenuTarget: HTMLElement
  declare readonly editorOutletElement: Element
  declare readonly hasEditorOutlet: boolean

  private unsubs: (() => void)[] = []
  private currentType: ActiveBlockType = ActiveBlockType.None
  private viewIsEditor = true
  private followMode = false
  private inViewport = true
  private stopKeyboardTrack: (() => void) | null = null
  private canUndo = false
  private addMenu: Menu | null = null
  private addMenuOpen = false

  connect(): void {
    this.element.innerHTML = renderEditToolbar({ icons: icons as Record<string, string> })
    this.addGroupTarget.hidden = false
    this.addMenu = new Menu({
      mountEl: this.fabMenuTarget,
      triggerEl: this.addBtnTarget,
      label: "Add",
      items: () => menuRegistry.get("add-block")!,
      panelClass: "edit-toolbar-fab-menu",
      onOpen: () => this.setAddMenuOpen(true),
      onClose: () => this.setAddMenuOpen(false),
    })
    this.unsubs.push(
      appEvents.on(AppEvent.BlockContextChanged, ({ context }) => {
        this.currentType = context.type
        this.renderToolbarOps(context)
        this.updateVisibility()
        this.positionPopover()
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.viewIsEditor = view === "editor"
        this.addMenu?.close()
        this.updateVisibility()
        this.positionPopover()
      }),
      appEvents.on(AppEvent.HistoryChanged, ({ canUndo, canRedo }) => {
        this.canUndo = canUndo
        this.setDisabled("tc-19", !canUndo)
        this.setDisabled("tc-20", !canRedo)
        this.updateVisibility()
      }),
    )
    // On-screen keyboard open → follow mode (the caret sits just above the
    // keys, so the strip would be hidden behind them). Visual-viewport
    // pan/scroll re-anchors the popover to the caret's block. Gated to touch
    // devices: phone/tablet by viewport, plus tablet by UA (a tablet in
    // landscape can still exceed the tablet breakpoint but pops the OSK).
    this.stopKeyboardTrack = trackKeyboardOffset((offset) => {
      this.followMode =
        offset > 0 && (isMobileViewport() || isTabletViewport() || isMobileOrTabletUA())
      this.element.classList.toggle("is-follow-mode", this.followMode)
      this.updateVisibility()
      this.positionPopover()
    })
    // The follow-mode popover anchors to the focused block; document scroll
    // can carry the block out of the viewport. Capture-phase: scroll events
    // from the inner .book-layout scroller don't bubble (same pattern as
    // code-block-ui.ts).
    window.addEventListener("scroll", this.onScroll, true)
    this.updateVisibility()
  }

  disconnect(): void {
    window.removeEventListener("scroll", this.onScroll, true)
    this.stopKeyboardTrack?.()
    this.stopKeyboardTrack = null
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.addMenu?.destroy()
    this.addMenu = null
  }

  exec(event: Event): void {
    const el = event.currentTarget as HTMLElement
    const cmd = el.dataset.cmd
    if (!cmd) return
    appEvents.emit(AppEvent.ToolbarCommandExec, {
      command: Number(cmd.replace("tc-", "")) as ToolbarCommand,
    })
  }

  // "+" FAB: toggle the shared add-block menu. Anchored at the button in both
  // modes (in follow mode the strip is the block-anchored popover, so the
  // button rect points at the caret's block) — never at the 0×0 #edit-toolbar
  // fixed anchor, which can still sit at the origin (left:0/top:0) until the
  // async editor-context import positions it.
  openAddMenu(): void {
    if (!this.addMenu) return
    if (this.addMenu.isOpen) {
      this.addMenu.close()
      return
    }
    this.addMenu.setAnchorRect(this.addBtnRect(), this.followMode)
    this.addMenu.openAndFocusFirst()
  }

  // Default mode is a plain bottom strip — nothing to position. Follow mode
  // opens the panel below the caret's block (above when the block sits too low,
  // and at the cursor when the block is taller than the viewport). Once the
  // anchored block scrolls fully out of view the popover hides.
  private positionPopover(): void {
    const panel = this.element.querySelector<HTMLElement>(".edit-toolbar")
    if (!panel) return
    if (!this.followMode) {
      // Back to the docked strip — clear any follow-mode anchor offsets.
      ;(this.element as HTMLElement).style.left = ""
      ;(this.element as HTMLElement).style.top = ""
      this.setInViewport(true)
      // The "+" button may be hidden while the add-block menu is open (the
      // strip hides then); its rect is only meaningful when visible.
      this.reanchorAddMenu(this.addBtnRect(), false)
      return
    }
    const milk = this.editor()?.getEditor()
    if (!milk) return
    void import("@/services/editor-context-service").then(({ getView }) => {
      if (!this.followMode) return
      const view = getView(milk)
      const { from } = view.state.selection
      const cursor = view.coordsAtPos(from)
      if (!cursor) return
      const block = getBlockRectAt(view, from) ?? cursor
      this.setInViewport(this.isBlockInView(block))
      if (!this.inViewport || !this.viewIsEditor) return
      applyPanelFlip(panel, {
        anchor: block,
        anchorCursor: cursor,
        preferAbove: false,
        positionAnchor: true,
        measureDisplay: "flex",
      })
      // While the add-block menu is open the strip is hidden, so its "+"
      // button has no rect — re-anchor the menu at the caret's block instead.
      this.reanchorAddMenu(block, true)
    })
  }

  // Re-anchor the popover on every scroll; positionPopover also hides it once
  // the anchored block scrolls out of the viewport.
  private onScroll = (): void => {
    this.positionPopover()
  }

  // The block rect is in layout-viewport coordinates; the visible area is the
  // visual viewport (offsetTop + height — the keyboard pan shifts offsetTop).
  private isBlockInView(block: FlipAnchorRect): boolean {
    const vv = window.visualViewport
    const top = vv ? vv.offsetTop : 0
    const bottom = top + (vv ? vv.height : window.innerHeight)
    return block.bottom > top && block.top < bottom
  }

  private setInViewport(inView: boolean): void {
    if (this.inViewport === inView) return
    this.inViewport = inView
    this.updateVisibility()
  }

  // editorOutlet is a blessed Stimulus getter that THROWS when the outlet
  // element lacks a connected "editor" controller — which is the case on thin
  // shells before the lazy editor chunk registers. Route every access through
  // this so positionPopover() never throws on that window.
  private editor(): EditorController | null {
    if (!this.hasEditorOutlet) return null
    return this.application.getControllerForElementAndIdentifier(
      this.editorOutletElement,
      "editor",
    ) as EditorController | null
  }

  private renderToolbarOps(context: ActiveBlockContext): void {
    const inList =
      context.type === ActiveBlockType.BulletList ||
      context.type === ActiveBlockType.OrderedList ||
      context.type === ActiveBlockType.TaskList
    const inTable = context.type === ActiveBlockType.Table
    this.listGroupTarget.hidden = !inList
    this.tableGroupTarget.hidden = !inTable
    // The "+" FAB-in-quick-menu hides while the focused block has its own
    // contextual actions (list/table).
    this.addGroupTarget.hidden = inList || inTable
    // Indent controls: always shown for a list item; increase indent is
    // disabled when the item can't sink (first child of its parent list).
    this.setVisible("tc-8", inList)
    this.setVisible("tc-7", inList)
    this.setDisabled("tc-7", inList && !context.canSink)
    // List-kind conversions: hide the button matching the current kind.
    this.setVisible("tc-11", inList && context.type !== ActiveBlockType.BulletList)
    this.setVisible("tc-13", inList && context.type !== ActiveBlockType.OrderedList)
    this.setVisible("tc-12", inList && context.type !== ActiveBlockType.TaskList)
    // Task on/off: show the action matching the current checked state.
    this.setVisible("tc-9", context.type === ActiveBlockType.TaskList && context.checked === false)
    this.setVisible("tc-10", context.type === ActiveBlockType.TaskList && context.checked === true)
    // All five table actions apply to whichever cell is focused.
    for (const cmd of ["tc-14", "tc-15", "tc-16", "tc-17", "tc-18"]) {
      this.setVisible(cmd, inTable)
    }
  }

  // Follow-mode popover visibility rule: follow only while the anchored block
  // is still on screen AND the popover has something useful — an enabled undo
  // or contextual list/table actions (or the "+" add-block button). A lone
  // enabled redo (the post-undo state) never triggers the popover.
  private hasUsableActions(): boolean {
    return (
      this.canUndo ||
      !this.listGroupTarget.hidden ||
      !this.tableGroupTarget.hidden ||
      !this.addGroupTarget.hidden
    )
  }

  private updateVisibility(): void {
    // Default mode: always visible in the editor view. Follow mode: only while
    // the anchored block is still on screen with something useful to offer.
    // While the add-block menu is open the element must stay visible — it
    // hosts the menu's fixed mount — only the strip hides (via
    // .edit-toolbar-fab-menu-open).
    ;(this.element as HTMLElement).hidden = this.addMenuOpen
      ? false
      : !(
          this.viewIsEditor &&
          (!this.followMode || (this.inViewport && this.hasUsableActions()))
        )
  }

  private setAddMenuOpen(open: boolean): void {
    if (this.addMenuOpen === open) return
    this.addMenuOpen = open
    this.element.classList.toggle("edit-toolbar-fab-menu-open", open)
    this.updateVisibility()
  }

  // Anchor the add-block menu at the "+" button's rect. In follow mode the
  // strip IS the block-anchored popover, so the button rect is already where
  // the caret's block is; never fall back to the 0×0 #edit-toolbar fixed
  // anchor, which can sit at left:0/top:0 until positionPopover's async
  // editor-context import runs (that's what opened the menu at the top-left).
  private addBtnRect(): FlipAnchorRect | null {
    const rect = this.addBtnTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right }
  }

  // While the add-block menu is open the strip hides, so the "+" button has no
  // rect; positionPopover re-anchors the open menu at the caret's block then.
  private reanchorAddMenu(rect: FlipAnchorRect | null, preferAbove: boolean): void {
    if (!this.addMenu?.isOpen || !rect) return
    this.addMenu.setAnchorRect(rect, preferAbove)
    this.addMenu.reposition()
  }

  private setVisible(cmd: string, visible: boolean): void {
    for (const el of this.btnTargets) {
      if (el.dataset.cmd !== cmd) continue
      el.hidden = !visible
    }
  }

  private setDisabled(cmd: string, disabled: boolean): void {
    for (const el of this.btnTargets) {
      if (el.dataset.cmd !== cmd) continue
      el.classList.toggle("is-disabled", disabled)
      if (disabled) {
        el.setAttribute("disabled", "")
        el.setAttribute("aria-disabled", "true")
      } else {
        el.removeAttribute("disabled")
        el.removeAttribute("aria-disabled")
      }
    }
  }
}
