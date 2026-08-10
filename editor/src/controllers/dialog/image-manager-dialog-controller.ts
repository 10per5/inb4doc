import type { ImageEntry } from "@/providers/provider"
import { BaseDialogController } from "./base-dialog-controller"
import { bindImageManagerActions } from "@/components/ui/image-manager"
import renderImageManagerDialog from "@/eta/views/dialog/image-manager-dialog"

export class ImageManagerDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    title: string
    dir?: string
    loadError?: string | null
    allEntries: (ImageEntry & { pending?: boolean })[]
    rows: string
  }

  connect() {
    this.element.innerHTML = renderImageManagerDialog(this.payloadValue)
    bindImageManagerActions(this.element as HTMLElement, {
      onAllImagesDeleted: () => this.cancel(),
    })
  }
}
