import { Controller } from "@hotwired/stimulus"
import { appEvents, AppEvent } from "@/stores/app-events"
import { ToolbarCommand } from "@/config/enums"
import * as icons from "@/eta/icons"
import renderEditToolbar from "@/eta/views/controller/edit-toolbar"

export default class EditToolbarController extends Controller {
  static targets = ["btn", "listGroup"]

  declare readonly btnTargets: HTMLElement[]
  declare readonly listGroupTarget: HTMLElement

  private unsubs: (() => void)[] = []
  private isListContext = false
  private viewIsEditor = true

  connect(): void {
    this.element.innerHTML = renderEditToolbar({ icons: icons as Record<string, string> })
    this.unsubs.push(
      appEvents.on(AppEvent.BlockContextChanged, ({ context }) => {
        this.isListContext = context.isListItem
        this.renderListOps(context)
        this.updateVisibility()
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        this.viewIsEditor = view === "editor"
        this.updateVisibility()
      }),
    )
  }

  disconnect(): void {
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
