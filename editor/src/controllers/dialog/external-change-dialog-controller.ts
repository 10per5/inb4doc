import { computeDiff, renderDiffHtml } from "@/components/ui/diff-viewer"
import { BaseDialogController } from "./base-dialog-controller"

export class ExternalChangeDialogController extends BaseDialogController {
  static targets = ["diffContainer"]
  static values = {
    local: String,
    disk: String,
  }

  declare diffContainerTarget: HTMLElement
  declare localValue: string
  declare diskValue: string
  declare diffLoaded: boolean

  connect() {
    this.diffLoaded = false
  }

  toggleDiff() {
    const btn = this.element.querySelector(".inb4doc-external-toggle") as HTMLButtonElement
    const visible = this.diffContainerTarget.style.display === "block"
    this.diffContainerTarget.style.display = visible ? "none" : "block"
    btn.textContent = visible ? "▸ View diff" : "▾ Hide diff"

    if (!visible && !this.diffLoaded) {
      const diff = computeDiff(this.localValue, this.diskValue)
      this.diffContainerTarget.innerHTML = renderDiffHtml(diff)
      this.diffLoaded = true
    }
  }

  discard() {
    this.confirm("discard")
  }

  keep() {
    this.confirm("keep")
  }
}
