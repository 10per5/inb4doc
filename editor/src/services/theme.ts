import { prefsStore } from "@/stores/preferences-store"

// Theme application lives here (not in the prefs dialog) so the core shell can
// apply the saved theme without pulling the lazy prefs-dialog chunk (Part D).
export function applyThemeFromPrefs(): void {
  if (prefsStore.darkMode) {
    document.documentElement.setAttribute("data-theme", "dark")
  } else {
    document.documentElement.removeAttribute("data-theme")
  }
}
