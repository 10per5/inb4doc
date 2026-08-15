import { prefsStore } from "@/stores/preferences-store"

// The Android shell reserves the camera/status-bar strip at the top of the
// screen and paints it with --color-bg-secondary; tell it which theme is active
// so the strip (and the status-bar icon contrast) follows the app's dark/light
// preference instead of guessing from the system. No-op off Android (the native
// bridge is absent), never crashes the web/desktop builds.
function notifyNativeTheme(dark: boolean): void {
  const nb = (window as any).NativeBridge as
    | { setTheme?: (theme: string) => void }
    | undefined
  if (nb && typeof nb.setTheme === "function") {
    try {
      nb.setTheme(dark ? "dark" : "light")
    } catch {}
  }
}

// Apply a concrete theme (sets the <html data-theme> attribute used by the CSS)
// and mirror it to the native shell. Shared by the boot path and the prefs
// toggle so both stay in lockstep.
export function applyTheme(dark: boolean): void {
  if (dark) {
    document.documentElement.setAttribute("data-theme", "dark")
  } else {
    document.documentElement.removeAttribute("data-theme")
  }
  notifyNativeTheme(dark)
}

// Theme application lives here (not in the prefs controller) so the core shell can
// apply the saved theme without pulling the lazy prefs chunk (Part D).
export function applyThemeFromPrefs(): void {
  applyTheme(prefsStore.darkMode)
}
