/**
 * Back-press registry — the single unwinder every Back source goes through.
 *
 * Native hosts call `window.inb4docUI.handleBack()` (which is `handleBack`
 * here); browser/PWA session history calls the same function from
 * `services/ui-history-service`. The shell registers one handler
 * (`ShellController.handleBackPressed`), so the layer order (dialog → window →
 * menu → controller-owned screen → fullview → editor) is defined exactly once
 * regardless of where the press came from.
 */

type BackHandler = () => boolean

let backHandler: BackHandler | null = null

export function registerBackHandler(fn: BackHandler | null): void {
  backHandler = fn
}

/**
 * Unwind exactly one layer. Returns true when the press was consumed and false
 * when there is nothing left to unwind — the host's cue to fall back to
 * in-page history and then leave the app.
 */
export function handleBack(): boolean {
  if (!backHandler) return false
  try {
    return backHandler()
  } catch {
    return false
  }
}
