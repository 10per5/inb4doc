import { BaseDialogController } from "./base-dialog-controller"
import renderConfirmDialog from "@/eta/views/dialog/confirm-dialog"

export class ConfirmDialogController extends BaseDialogController {
  static targets = ["box"]
  static values = { payload: Object }

  declare boxTarget: HTMLElement
  declare payloadValue: {
    title: string
    message: string
    cancelLabel?: string
    confirmLabel?: string
    confirmClass?: string
  }

  connect() {
    this.element.innerHTML = renderConfirmDialog(this.payloadValue)
  }

  onEnter() {
    this.confirm(true)
  }
}
