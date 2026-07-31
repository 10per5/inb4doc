import { BaseDialogController } from "./base-dialog-controller"
import renderLinkDialog from "@/eta/views/dialog/link-dialog"

export class LinkDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    inputId: string
    initialUrl?: string
  }

  connect() {
    this.element.innerHTML = renderLinkDialog(this.payloadValue)
    this.focusInput("input", { raf: true })
  }

  onEnter() {
    const input = this.element.querySelector("input") as HTMLInputElement | null
    this.confirm(input?.value.trim() ?? "")
  }
}
