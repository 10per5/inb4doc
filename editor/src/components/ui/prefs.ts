import type { ImageStorageMode } from "@/services/storage-service"
import { prefsStore } from "@/stores/preferences-store"
import { appEvents, AppEvent } from "@/stores/app-events"
import { applyTheme } from "@/utils/theme"

/**
 * Shared preferences handlers — used by the desktop tabbed dialog and the
 * mobile per-section screens (one controller per feature: PrefsController
 * renders either from the payload presence). The controller wires these to its
 * own Stimulus change actions.
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

export function onPrefsHideEmptyFoldersChanged(hide: boolean): void {
  prefsStore.setHideEmptyFolders(hide)
  appEvents.emit(AppEvent.RootScopeChanged)
}

/** `root` is a root-level folder path; "" shows every project at once. */
export function onPrefsRootScopeChanged(root: string): void {
  prefsStore.setRootScope(root)
  appEvents.emit(AppEvent.RootScopeChanged)
}

export function onPrefsSpellcheckChanged(enabled: boolean): void {
  prefsStore.setSpellcheck(enabled)
  appEvents.emit(AppEvent.SpellcheckChanged)
}

export function onPrefsSpellcheckLanguagesChanged(tags: string[]): void {
  prefsStore.setSpellcheckLanguages(tags)
  appEvents.emit(AppEvent.SpellcheckChanged)
}

/** Mobile edit toolbar: follow the caret, or stay pinned at the bottom. */
export function onPrefsFollowCaretToolbarChanged(follow: boolean): void {
  prefsStore.setFollowCaretToolbar(follow)
  appEvents.emit(AppEvent.FollowCaretToolbarChanged, { follow })
}
