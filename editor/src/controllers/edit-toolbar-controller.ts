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
  private currentCmd = new Map<string, boolean>()
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
  }): void {
    this.listGroupTarget.hidden = !context.isListItem
    this.setCmd("tc-9", context.isListItem && context.listType === "task" && context.checked === false)
    this.setCmd("tc-10", context.isListItem && context.listType === "task" && context.checked === true)
    this.setCmd("tc-7", context.isListItem)
    this.setCmd("tc-8", context.isListItem)
  }

  private updateVisibility(): void {
    ;(this.element as HTMLElement).hidden = !(this.viewIsEditor && this.isListContext)
  }

  private setCmd(cmd: string, active: boolean): void {
    if (this.currentCmd.get(cmd) === active) return
    this.currentCmd.set(cmd, active)
    for (const el of this.btnTargets) {
      if (el.dataset.cmd !== cmd) continue
      el.classList.toggle("is-active", active)
      el.setAttribute("aria-pressed", active ? "true" : "false")
    }
  }
}
