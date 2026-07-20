import { savePrefs, type ImageStorageMode } from "@/utils/storage"
import { BaseDialogController } from "./base-dialog-controller"

export const PrefsDialogEvent = {
  StickyChange:    "prefs-dialog:sticky-change",
  ImageModeChange: "prefs-dialog:image-mode-change",
} as const

interface PrefsData {
  stickyToolbar: boolean
  darkMode: boolean
  imageStorageMode: ImageStorageMode
}

export class PrefsDialogController extends BaseDialogController {
  static values = {
    sticky: Boolean,
    dark: Boolean,
    imageMode: String,
  }

  declare stickyValue: boolean
  declare darkValue: boolean
  declare imageModeValue: string

  declare prefs: PrefsData

  connect() {
    this.prefs = {
      stickyToolbar: this.stickyValue,
      darkMode: this.darkValue,
      imageStorageMode: (this.imageModeValue as ImageStorageMode) ?? "file",
    }
  }

  stickyChanged(e: Event) {
    this.prefs.stickyToolbar = (e.target as HTMLInputElement).checked
    savePrefs(this.prefs)
    this.dispatch("sticky-change", { detail: this.prefs.stickyToolbar, bubbles: true })
  }

  darkChanged(e: Event) {
    this.prefs.darkMode = (e.target as HTMLInputElement).checked
    savePrefs(this.prefs)
    if (this.prefs.darkMode) {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
  }

  imageModeChanged(e: Event) {
    const radio = e.target as HTMLInputElement
    if (radio.checked) {
      this.prefs.imageStorageMode = radio.value as ImageStorageMode
      savePrefs(this.prefs)
      this.dispatch("image-mode-change", { detail: this.prefs.imageStorageMode, bubbles: true })
    }
  }
}
