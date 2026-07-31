import type { ImageStorageMode } from "@/services/storage"
import { prefsStore } from "@/stores/preferences-store"
import { BaseDialogController } from "./base-dialog-controller"
import renderPrefsDialog from "@/eta/views/dialog/prefs-dialog"

export const PrefsDialogEvent = {
  StickyChange:    "prefs-dialog:sticky-change",
  ImageModeChange: "prefs-dialog:image-mode-change",
} as const

export class PrefsDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    stickyToolbar: boolean
    darkMode: boolean
    imageStorageMode: ImageStorageMode
  }

  connect() {
    this.element.innerHTML = renderPrefsDialog(this.payloadValue)
  }

  stickyChanged(e: Event) {
    const v = (e.target as HTMLInputElement).checked
    prefsStore.setStickyToolbar(v)
    this.dispatch("sticky-change", { detail: v, bubbles: true })
  }

  darkChanged(e: Event) {
    const v = (e.target as HTMLInputElement).checked
    prefsStore.setDarkMode(v)
    if (v) {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
  }

  imageModeChanged(e: Event) {
    const radio = e.target as HTMLInputElement
    if (radio.checked) {
      prefsStore.setImageStorageMode(radio.value as ImageStorageMode)
      this.dispatch("image-mode-change", { detail: radio.value, bubbles: true })
    }
  }
}
