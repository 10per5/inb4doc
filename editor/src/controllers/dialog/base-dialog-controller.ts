import { Controller } from "@hotwired/stimulus"
import { DialogEvent } from "./dialog-events"

export class BaseDialogController extends Controller {
  cancel() {
    this.dispatch("cancel", { prefix: "dialog", bubbles: true })
  }

  close() {
    this.cancel()
  }

  confirm(detail?: string | number | boolean | object) {
    this.dispatch("confirm", { detail, prefix: "dialog", bubbles: true })
  }

  keydown(e: KeyboardEvent) {
    if (e.key === "Enter") this.onEnter()
    if (e.key === "Escape") this.cancel()
  }

  onEnter() {
    // Override in subclass for Enter key behavior
  }

  focusInput(selector = "input", options?: { raf?: boolean }) {
    const input = this.element.querySelector(selector) as HTMLInputElement | null
    if (!input) return
    if (options?.raf) {
      requestAnimationFrame(() => {
        input.focus()
        input.select()
      })
    } else {
      input.focus()
      input.select()
    }
  }
}
