import type { ImageStorageMode } from "@/services/storage-service"
import { prefsStore } from "@/stores/preferences-store"
import { appEvents, AppEvent } from "@/stores/app-events"
import { applyTheme } from "@/utils/theme"

/**
 * Shared preferences handlers — used by both the desktop dialog and the
 * mobile prefs screen (one controller per feature: PrefsController renders
 * either from the payload presence). The controller wires these to its own
 * Stimulus change actions.
 */
export function onPrefsStickyChanged(sticky: boolean): void {
  prefsStore.setStickyToolbar(sticky)
  appEvents.emit(AppEvent.StickyPreferenceChanged, { sticky })
}

export function onPrefsDarkChanged(dark: boolean): void {
  prefsStore.setDarkMode(dark)
  applyTheme(dark)
}

export function onPrefsImageModeChanged(mode: ImageStorageMode): void {
  prefsStore.setImageStorageMode(mode)
}
