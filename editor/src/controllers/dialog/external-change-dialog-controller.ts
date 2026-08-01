import { renderPendingDiff } from "@/components/ui/pending-diff"
import { BaseDialogController } from "./base-dialog-controller"
import { navArrowRight, navArrowDown } from "@/eta/icons"
import renderExternalChangeDialog from "@/eta/views/dialog/external-change-dialog"

export class ExternalChangeDialogController extends BaseDialogController {
  static targets = ["diffContainer"]
  static values = { payload: Object }

  declare diffContainerTarget: HTMLElement
  declare diffLoaded: boolean

  declare payloadValue: {
    path: string
    local: string
    disk: string
    icons?: { navArrowRight?: string }
  }

  connect() {
    this.element.innerHTML = renderExternalChangeDialog(this.payloadValue)
    this.diffLoaded = false
  }

  toggleDiff() {
    const btn = this.element.querySelector(".inb4doc-external-toggle") as HTMLButtonElement
    const visible = this.diffContainerTarget.style.display === "block"
    this.diffContainerTarget.style.display = visible ? "none" : "block"
    btn.innerHTML = visible ? `${navArrowRight} View diff` : `${navArrowDown} Hide diff`

    if (!visible && !this.diffLoaded) {
      this.diffContainerTarget.innerHTML = renderPendingDiff(
        this.payloadValue.disk,
        this.payloadValue.local,
      )
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
