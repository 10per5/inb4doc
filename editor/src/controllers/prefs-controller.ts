import * as icons from "@/eta/icons"
import { BaseDialogController } from "./dialog/base-dialog-controller"
import { prefsStore } from "@/stores/preferences-store"
import type { ImageStorageMode } from "@/services/storage"
import { onPrefsStickyChanged, onPrefsDarkChanged, onPrefsImageModeChanged } from "@/components/ui/prefs"
import { appEvents, AppEvent } from "@/stores/app-events"
import { openDialog } from "@/services/dialog-service"
import { renderScreen } from "@/eta/views/screen"
import renderPrefsDialog from "@/eta/views/dialog/prefs-dialog"
import renderPrefsFields from "@/eta/views/prefs-fields"
import renderPrefsScreen from "@/eta/views/controller/prefs-screen"

// One controller per feature: registered as `prefs`, it renders the desktop
// dialog when the element carries a payload (dialog-service mounts
// data-prefs-payload-value) and the mobile fullview screen otherwise.
export default class PrefsController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    stickyToolbar: boolean
    darkMode: boolean
    imageStorageMode: ImageStorageMode
  }

  // Stimulus generates this runtime getter from `static values`; the shipped
  // types don't (dialogs always carried a payload before the merge).
  declare readonly hasPayloadValue: boolean

  connect(): void {
    if (this.hasPayloadValue) {
      this.element.innerHTML = renderPrefsDialog({
        ...this.payloadValue,
        form: renderPrefsFields({
          ...this.payloadValue,
          controller: "prefs",
        }),
      })
      return
    }
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderPrefsScreen({
      icons: icons as Record<string, string>,
      renderScreen,
      form: renderPrefsFields({
        stickyToolbar: prefsStore.stickyToolbar,
        darkMode: prefsStore.darkMode,
        imageStorageMode: prefsStore.imageStorageMode,
        controller: "prefs",
      }),
    })
  }

  close(): void {
    if (this.hasPayloadValue) {
      this.cancel()
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  stickyChanged(e: Event): void {
    onPrefsStickyChanged((e.target as HTMLInputElement).checked)
  }

  darkChanged(e: Event): void {
    onPrefsDarkChanged((e.target as HTMLInputElement).checked)
  }

  imageModeChanged(e: Event): void {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsImageModeChanged(radio.value as ImageStorageMode)
  }
}

/** Dialog facade — used by shell_controller's desktop path. */
export function openPrefsDialog(): void {
  openDialog("prefs", {
    stickyToolbar: prefsStore.stickyToolbar,
    darkMode: prefsStore.darkMode,
    imageStorageMode: prefsStore.imageStorageMode,
  })
}
