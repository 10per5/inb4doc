import { loadPrefs, savePrefs } from "@/utils/storage"
import type { ImageStorageMode } from "@/utils/storage"
import { openHtmlDialog } from "@/services/dialog-service"
import renderPrefsDialog from "@/eta/dialogs/prefs-dialog"
import { PrefsDialogEvent } from "@/controllers/dialog/prefs-dialog-controller"

export function applyThemeFromPrefs() {
  const prefs = loadPrefs()
  if (prefs.darkMode) {
    document.documentElement.setAttribute("data-theme", "dark")
  } else {
    document.documentElement.removeAttribute("data-theme")
  }
}

export interface PrefsDialogActions {
  onStickyToolbarChange: (sticky: boolean) => void
  onImageStorageModeChange?: (mode: ImageStorageMode) => void
}

export function openPrefsDialog(actions: PrefsDialogActions) {
  const prefs = loadPrefs()

  const html = renderPrefsDialog({
    stickyToolbar: prefs.stickyToolbar,
    darkMode: prefs.darkMode,
    imageStorageMode: prefs.imageStorageMode,
  })

  const { el: overlay, close } = openHtmlDialog({ html })

  overlay.addEventListener(PrefsDialogEvent.StickyChange, ((e: CustomEvent) => {
    actions.onStickyToolbarChange(e.detail)
  }) as EventListener)

  overlay.addEventListener(PrefsDialogEvent.ImageModeChange, ((e: CustomEvent) => {
    actions.onImageStorageModeChange?.(e.detail)
  }) as EventListener)

  overlay.addEventListener("dialog:cancel", () => close())
}
