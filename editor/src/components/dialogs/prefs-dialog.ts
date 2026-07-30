import type { ImageStorageMode } from "@/services/storage"
import { prefsStore } from "@/stores/preferences-store"
import { openHtmlDialog } from "@/services/dialog-service"
import renderPrefsDialog from "@/eta/dialogs/prefs-dialog"
import { PrefsDialogEvent } from "@/controllers/dialog/prefs-dialog-controller"

export function applyThemeFromPrefs() {
  if (prefsStore.darkMode) {
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
  const html = renderPrefsDialog({
    stickyToolbar: prefsStore.stickyToolbar,
    darkMode: prefsStore.darkMode,
    imageStorageMode: prefsStore.imageStorageMode,
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
