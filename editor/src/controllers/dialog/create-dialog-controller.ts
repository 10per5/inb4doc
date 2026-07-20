import { isHugoIndex, HUGO_INDEX_HINT } from "@/utils/hugo-compat"
import { BaseDialogController } from "./base-dialog-controller"

export class CreateDialogController extends BaseDialogController {
  connect() {
    this.focusInput("input[type='text']")
  }

  inputChanged(e: Event) {
    const val = (e.target as HTMLInputElement).value.trim()
    const hintEl = this.element.querySelector(".inb4doc-hint")
    if (hintEl) hintEl.textContent = isHugoIndex(val) ? HUGO_INDEX_HINT : ""
  }

  onEnter() {
    const input = this.element.querySelector("input[type='text']") as HTMLInputElement | null
    const checkbox = this.element.querySelector("input[type='checkbox']") as HTMLInputElement | null
    const name = input?.value?.trim()
    if (!name) return
    this.confirm({ name, asDirectory: checkbox?.checked ?? false })
  }
}
