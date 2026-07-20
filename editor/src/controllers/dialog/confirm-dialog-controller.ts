import { BaseDialogController } from "./base-dialog-controller"

export class ConfirmDialogController extends BaseDialogController {
  static targets = ["box"]

  declare boxTarget: HTMLElement

  onEnter() {
    this.confirm(true)
  }
}
