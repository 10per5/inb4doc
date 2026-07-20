import { BaseDialogController } from "./base-dialog-controller"

export class HugoRefDialogController extends BaseDialogController {
  connect() {
    this.focusInput("input", { raf: true })
  }

  keydown(e: KeyboardEvent) {
    if (e.key === "Enter") this.save()
  }

  save() {
    const inputs = this.element.querySelectorAll("input")
    const path = (inputs[0] as HTMLInputElement)?.value.trim()
    const title = (inputs[1] as HTMLInputElement)?.value.trim()
    if (!path) return
    this.confirm({ path, title: title || path.split("/").pop() || "" })
  }

  remove() {
    this.dispatch("remove", { bubbles: true })
  }
}
