import type { ImageStorageMode } from "@/services/storage"
import { prefsStore } from "@/stores/preferences-store"
import { openDialog } from "@/services/dialog-service"
import { PrefsDialogEvent } from "./prefs-dialog-controller"

export interface PrefsDialogActions {
  onStickyToolbarChange: (sticky: boolean) => void
  onImageStorageModeChange?: (mode: ImageStorageMode) => void
}

export function openPrefsDialog(actions: PrefsDialogActions) {
  openDialog("prefs-dialog", {
    stickyToolbar: prefsStore.stickyToolbar,
    darkMode: prefsStore.darkMode,
    imageStorageMode: prefsStore.imageStorageMode,
  }, {
    listeners: {
      [PrefsDialogEvent.StickyChange]: ((e: CustomEvent<boolean>) => {
        actions.onStickyToolbarChange(e.detail)
      }) as EventListener,
      [PrefsDialogEvent.ImageModeChange]: ((e: CustomEvent<ImageStorageMode>) => {
        actions.onImageStorageModeChange?.(e.detail)
      }) as EventListener,
    },
  })
}
