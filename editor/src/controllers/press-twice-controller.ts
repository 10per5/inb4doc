import { Controller } from "@hotwired/stimulus"

export class PressTwiceController extends Controller {
  static values = {
    idleText: { type: String, default: "" },
    pendingText: { type: String, default: "" },
    timeout: { type: Number, default: 3000 },
  }

  declare idleTextValue: string
  declare pendingTextValue: string
  declare timeoutValue: number

  pending = false
  timeoutId: ReturnType<typeof setTimeout> | null = null

  click() {
    if (this.pending) {
      this.clearPending()
      this.dispatch("confirm", { bubbles: true })
    } else {
      this.pending = true
      this.element.textContent = this.pendingTextValue || this.idleTextValue
      this.timeoutId = setTimeout(() => this.clearPending(), this.timeoutValue)
    }
  }

  clearPending() {
    this.pending = false
    if (this.timeoutId !== null) clearTimeout(this.timeoutId)
    this.timeoutId = null
    this.element.textContent = this.idleTextValue
  }

  disconnect() {
    this.clearPending()
  }
}
