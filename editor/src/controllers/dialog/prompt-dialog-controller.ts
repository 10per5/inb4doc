import { BaseDialogController } from "./base-dialog-controller"
import renderPromptDialog from "@/eta/views/dialog/prompt-dialog"

export class PromptDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    title: string
    label?: string
    placeholder?: string
    value?: string
    cancelLabel?: string
    confirmLabel?: string
    inputId: string
  }

  connect() {
    this.element.innerHTML = renderPromptDialog(this.payloadValue)
    this.focusInput()
  }

  onEnter() {
    const input = this.element.querySelector("input") as HTMLInputElement | null
    this.confirm(input?.value ?? "")
  }
}
