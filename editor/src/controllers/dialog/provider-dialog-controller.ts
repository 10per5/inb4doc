import { BaseDialogController } from "./base-dialog-controller"

export const ProviderDialogEvent = {
  Select: "provider-dialog:select",
  Probe:  "provider-dialog:probe",
  Accept: "provider-dialog:accept",
  Cancel: "provider-dialog:cancel",
} as const

export class ProviderDialogController extends BaseDialogController {
  selectProvider(e: Event) {
    const type = (e.currentTarget as HTMLElement).dataset.type
    if (type) this.dispatch("select", { detail: type, bubbles: true })
  }

  stopPropagation(e: Event) {
    e.stopPropagation()
  }

  scheduleProbe() {
    const statusEl = this.element.querySelector(".remote-status")
    if (statusEl) {
      statusEl.textContent = ""
      statusEl.className = "remote-status"
    }

    setTimeout(() => {
      const inputs = this.element.querySelectorAll(".remote-field input")
      const host = (inputs[0] as HTMLInputElement)?.value.trim() || "localhost"
      const port = parseInt((inputs[1] as HTMLInputElement)?.value || "3000", 10)
      this.dispatch("probe", { detail: { host, port }, bubbles: true })
    }, 600)
  }

  cancel() {
    this.dispatch("cancel", { bubbles: true })
  }

  accept() {
    const selected = this.element.querySelector(".provider-option-selected")
    const type = selected?.getAttribute("data-type")
    if (type) this.dispatch("accept", { detail: type, bubbles: true })
  }
}
