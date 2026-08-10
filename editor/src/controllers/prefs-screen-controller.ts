import { Controller } from "@hotwired/stimulus"
import * as icons from "@/eta/icons"
import { prefsStore } from "@/stores/preferences-store"
import type { ImageStorageMode } from "@/services/storage"
import { onPrefsStickyChanged, onPrefsDarkChanged, onPrefsImageModeChanged } from "@/components/ui/prefs"
import { appEvents, AppEvent } from "@/stores/app-events"
import { renderScreen } from "@/eta/views/screen"
import renderPrefsFields from "@/eta/views/prefs-fields"
import renderPrefsScreen from "@/eta/views/controller/prefs-screen"

export default class PrefsScreenController extends Controller {
  connect(): void {
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderPrefsScreen({
      icons: icons as Record<string, string>,
      renderScreen,
      form: renderPrefsFields({
        stickyToolbar: prefsStore.stickyToolbar,
        darkMode: prefsStore.darkMode,
        imageStorageMode: prefsStore.imageStorageMode,
        controller: "prefs-screen",
      }),
    })
  }

  close(): void {
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
