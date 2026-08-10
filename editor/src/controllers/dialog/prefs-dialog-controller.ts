import type { ImageStorageMode } from "@/services/storage"
import { BaseDialogController } from "./base-dialog-controller"
import { onPrefsStickyChanged, onPrefsDarkChanged, onPrefsImageModeChanged } from "@/components/ui/prefs"
import renderPrefsDialog from "@/eta/views/dialog/prefs-dialog"
import renderPrefsFields from "@/eta/views/prefs-fields"

export class PrefsDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    stickyToolbar: boolean
    darkMode: boolean
    imageStorageMode: ImageStorageMode
  }

  connect() {
    this.element.innerHTML = renderPrefsDialog({
      ...this.payloadValue,
      form: renderPrefsFields({
        ...this.payloadValue,
        controller: "prefs-dialog",
      }),
    })
  }

  stickyChanged(e: Event) {
    onPrefsStickyChanged((e.target as HTMLInputElement).checked)
  }

  darkChanged(e: Event) {
    onPrefsDarkChanged((e.target as HTMLInputElement).checked)
  }

  imageModeChanged(e: Event) {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsImageModeChanged(radio.value as ImageStorageMode)
  }
}
