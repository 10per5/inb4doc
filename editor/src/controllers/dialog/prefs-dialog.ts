import { prefsStore } from "@/stores/preferences-store"
import { openDialog } from "@/services/dialog-service"

export function openPrefsDialog() {
  openDialog("prefs-dialog", {
    stickyToolbar: prefsStore.stickyToolbar,
    darkMode: prefsStore.darkMode,
    imageStorageMode: prefsStore.imageStorageMode,
  })
}
