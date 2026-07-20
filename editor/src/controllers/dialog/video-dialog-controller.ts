import { BaseDialogController } from "./base-dialog-controller"

export class VideoDialogController extends BaseDialogController {
  static targets = ["controls", "loop", "muted", "autoplay"]

  declare controlsTarget: HTMLInputElement
  declare loopTarget: HTMLInputElement
  declare mutedTarget: HTMLInputElement
  declare autoplayTarget: HTMLInputElement

  keydown(e: KeyboardEvent) {
    if (e.key === "Enter") this.save()
  }

  save() {
    const allInputs = this.element.querySelectorAll("input[type='text']")
    const src = (allInputs[0] as HTMLInputElement)?.value.trim() || ""
    const width = (allInputs[1] as HTMLInputElement)?.value.trim() || ""
    const height = (allInputs[2] as HTMLInputElement)?.value.trim() || ""

    this.confirm({
      src,
      width,
      height,
      controls: this.controlsTarget?.checked ?? true,
      loop: this.loopTarget?.checked ?? false,
      muted: this.mutedTarget?.checked ?? false,
      autoplay: this.autoplayTarget?.checked ?? false,
    })
  }

  remove() {
    this.confirm({})
    this.dispatch("remove", { bubbles: true })
  }
}
