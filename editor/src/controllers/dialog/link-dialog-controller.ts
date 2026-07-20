import { BaseDialogController } from "./base-dialog-controller"

export class LinkDialogController extends BaseDialogController {
  connect() {
    this.focusInput("input", { raf: true })
  }

  onEnter() {
    const input = this.element.querySelector("input") as HTMLInputElement | null
    this.confirm(input?.value.trim() ?? "")
  }
}
