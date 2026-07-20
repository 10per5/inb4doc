import { BaseDialogController } from "./base-dialog-controller"

export class PromptDialogController extends BaseDialogController {
  connect() {
    this.focusInput()
  }

  onEnter() {
    const input = this.element.querySelector("input") as HTMLInputElement | null
    this.confirm(input?.value ?? "")
  }
}
