import type { ImageStorageMode } from "@/services/storage"
import { prefsStore } from "@/stores/preferences-store"
import { BaseDialogController } from "./base-dialog-controller"

export const PrefsDialogEvent = {
  StickyChange:    "prefs-dialog:sticky-change",
  ImageModeChange: "prefs-dialog:image-mode-change",
} as const

export class PrefsDialogController extends BaseDialogController {
  static values = {
    sticky: Boolean,
    dark: Boolean,
    imageMode: String,
  }

  declare stickyValue: boolean
  declare darkValue: boolean
  declare imageModeValue: string

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
