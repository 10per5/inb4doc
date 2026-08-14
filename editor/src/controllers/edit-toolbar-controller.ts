import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import { ActiveBlockType, type ActiveBlockContext } from "@/config/enums/block-context"
import * as icons from "@/eta/icons"
import renderEditToolbar from "@/eta/views/controller/edit-toolbar"
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
 *   scrolls out of the viewport.
 * Undo/redo are always shown in both modes (disabled when the open file has
 * no history); the list/table groups appear contextually inside the bar.
 */
export default class EditToolbarController extends Controller {
  static targets = ["btn", "listGroup", "tableGroup"]
  static outlets = ["editor"]

  declare readonly btnTargets: HTMLElement[]
  declare readonly listGroupTarget: HTMLElement
  declare readonly tableGroupTarget: HTMLElement
  declare readonly editorOutletElement: Element
  declare readonly hasEditorOutlet: boolean

  private unsubs: (() => void)[] = []
  private currentType: ActiveBlockType = ActiveBlockType.None
  private viewIsEditor = true
  private followMode = false
  private inViewport = true
  private stopKeyboardTrack: (() => void) | null = null

  connect(): void {
    this.element.innerHTML = renderEditToolbar({ icons: icons as Record<string, string> })
    this.unsubs.push(
      appEvents.on(AppEvent.BlockContextChanged, ({ context }) => {
        this.currentType = context.type
        this.renderToolbarOps(context)
        this.updateVisibility()
        this.positionPopover()
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.viewIsEditor = view === "editor"
        this.updateVisibility()
        this.positionPopover()
      }),
      appEvents.on(AppEvent.HistoryChanged, ({ canUndo, canRedo }) => {
        this.setDisabled("tc-19", !canUndo)
        this.setDisabled("tc-20", !canRedo)
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
  }

  exec(event: Event): void {
    const el = event.currentTarget as HTMLElement
    const cmd = el.dataset.cmd
    if (!cmd) return
    appEvents.emit(AppEvent.ToolbarCommandExec, {
      command: Number(cmd.replace("tc-", "")) as ToolbarCommand,
    })
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

  private updateVisibility(): void {
    // Default mode: always visible in the editor view. Follow mode: only while
    // the anchored block is still on screen.
    ;(this.element as HTMLElement).hidden = !(
      this.viewIsEditor &&
      (!this.followMode || this.inViewport)
    )
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
