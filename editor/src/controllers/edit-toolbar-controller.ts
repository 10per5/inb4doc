import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import * as icons from "@/eta/icons"
import renderEditToolbar from "@/eta/views/controller/edit-toolbar"
import { trackKeyboardOffset } from "@/utils/mobile"
import { applyPanelFlip, getBlockRectAt } from "@/utils/popover"
import type { EditorController } from "@/controllers/editor-controller"

export default class EditToolbarController extends Controller {
  static targets = ["btn", "listGroup"]
  static outlets = ["editor"]

  declare readonly btnTargets: HTMLElement[]
  declare readonly listGroupTarget: HTMLElement
  declare readonly editorOutletElement: Element
  declare readonly hasEditorOutlet: boolean

  private unsubs: (() => void)[] = []
  private isListContext = false
  private viewIsEditor = true
  private stopKeyboardTrack: (() => void) | null = null

  connect(): void {
    this.element.innerHTML = renderEditToolbar({ icons: icons as Record<string, string> })
    this.unsubs.push(
      appEvents.on(AppEvent.BlockContextChanged, ({ context }) => {
        this.isListContext = context.isListItem
        this.renderListOps(context)
        this.updateVisibility()
        this.positionPopover()
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.viewIsEditor = view === "editor"
        this.updateVisibility()
        this.positionPopover()
      }),
    )
    // Opening/closing the on-screen keyboard (and visual-viewport scrolling)
    // moves the block the popover is anchored to, so re-anchor on those too.
    this.stopKeyboardTrack = trackKeyboardOffset(() => {
      this.positionPopover()
    })
    this.updateVisibility()
  }

  disconnect(): void {
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

  // The panel is a popover anchored at the block holding the current selection,
  // left-aligned to the block. #edit-toolbar is a 0×0 fixed anchor that
  // applyPanelFlip moves (positionAnchor) so the .edit-toolbar panel opens
  // BELOW the block when it fits — above only when the block sits too low —
  // and, for blocks taller than the viewport, on the side away from the cursor
  // (cursor near the bottom → above, near the top → below).
  private positionPopover(): void {
    const anchor = this.element as HTMLElement
    const panel = this.element.querySelector<HTMLElement>(".edit-toolbar")
    if (!panel || anchor.hidden) return
    const milk = this.editor()?.getEditor()
    if (!milk) return
    void import("@/services/editor-context").then(({ getView }) => {
      if (anchor.hidden) return
      const view = getView(milk)
      const { from } = view.state.selection
      const cursor = view.coordsAtPos(from)
      if (!cursor) return
      applyPanelFlip(panel, {
        anchor: getBlockRectAt(view, from) ?? cursor,
        anchorCursor: cursor,
        preferAbove: false,
        positionAnchor: true,
        measureDisplay: "flex",
      })
    })
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

  private renderListOps(context: {
    isListItem: boolean
    listType: "bullet" | "ordered" | "task" | null
    checked: boolean | null
    canSink: boolean
  }): void {
    this.listGroupTarget.hidden = !context.isListItem
    const inList = context.isListItem
    // Indent controls: always shown for a list item; increase indent is
    // disabled when the item can't sink (first child of its parent list).
    this.setVisible("tc-8", inList)
    this.setVisible("tc-7", inList)
    this.setDisabled("tc-7", inList && !context.canSink)
    // List-kind conversions: hide the button matching the current kind.
    this.setVisible("tc-11", inList && context.listType !== "bullet")
    this.setVisible("tc-13", inList && context.listType !== "ordered")
    this.setVisible("tc-12", inList && context.listType !== "task")
    // Task on/off: show the action matching the current checked state.
    this.setVisible("tc-9", inList && context.listType === "task" && context.checked === false)
    this.setVisible("tc-10", inList && context.listType === "task" && context.checked === true)
  }

  private updateVisibility(): void {
    ;(this.element as HTMLElement).hidden = !(this.viewIsEditor && this.isListContext)
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
