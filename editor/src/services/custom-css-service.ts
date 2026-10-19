import { prefsStore } from "@/stores/preferences-store"

/**
 * User stylesheet — the "Custom CSS" preference.
 *
 * One `<style>` element owned by this module, appended LAST in `<head>` so the
 * author's rules cascade after every bundled stylesheet (app CSS and the
 * compiled conditions.css alike) and can therefore override anything. It is
 * created lazily and reused: rebuilding it on every keystroke would throw away
 * the rules the browser already parsed, and keeping the same node means the
 * edits apply live while typing in Preferences.
 */
const STYLE_ID = "inb4doc-custom-css"

function styleEl(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement("style")
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  return el
}

export function applyCustomCss(css: string): void {
  const el = styleEl()
  if (!el) return
  el.textContent = css ?? ""
}

/** Apply the persisted stylesheet at boot. */
export function initCustomCss(): void {
  applyCustomCss(prefsStore.customCss)
}
