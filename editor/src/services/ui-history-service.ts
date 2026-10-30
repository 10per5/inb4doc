/**
 * UI history — browser/PWA counterpart of the native "back" contract.
 *
 * There is exactly one unwinder (`services/back-service` → the shell's
 * `handleBackPressed`), shared with the native host bridge. This module only
 * decides *when* to call it in a browser:
 *
 * - while at least one layer is open, keep **one** extra history entry on top
 *   of the current document,
 * - a user Back pops that entry, we unwind exactly one layer, and re-push the
 *   entry if anything is still open (so the next Back unwinds the next layer),
 * - closing the last layer ourselves pops the entry again.
 *
 * Layers report their own count by source (`view`, `menu`, `dialog`, `window`)
 * so a window stack (prefs → storage backend) still needs one Back per window.
 *
 * Document navigation must never race this bookkeeping: `markDocumentSwitch()`
 * is called when a document is opened, which releases the layer entry to
 * `navigate()` (it replaces the entry instead of pushing) rather than popping
 * it. `history.back()` next to a `pushState` pops the document that was just
 * opened — the bug that made tapping a file on mobile appear to do nothing.
 *
 * Native hosts are excluded entirely (`usesBrowserHistory()`): their fixed
 * shell URL has no document history and the bridge owns Back.
 */

import {
  getCurrentPath,
  markDocumentPathAdopted,
  setBeforePathReplace,
  usesBrowserHistory,
} from "@/utils/url"
import { handleBack } from "@/services/back-service"
import { appEvents, AppEvent } from "@/stores/app-events"

export type UiLayer = "view" | "menu" | "dialog" | "window"

const counts = new Map<UiLayer, number>()
let entryPushed = false
/** Pops caused by our own `history.back()` — not user Back presses. */
let ignorePops = 0
let syncQueued = false
let popWired = false
/** Deferred sentinel pop, so a close→replacePath in the same flow wins. */
let popTimer: ReturnType<typeof setTimeout> | null = null

/** Report how many layers of one kind are currently open. */
export function setUiLayerCount(source: UiLayer, count: number): void {
  if (count > 0) counts.set(source, count)
  else counts.delete(source)
  queueSync()
}

/**
 * A document is being opened: hand the layer entry to `navigate()`, which will
 * replace it with the document URL. Called synchronously before the navigation
 * pushes so the entry is never popped mid-flight.
 */
export function markDocumentSwitch(): void {
  cancelPendingPop()
  if (!entryPushed) return
  entryPushed = false
  markDocumentPathAdopted()
}

function anyLayerOpen(): boolean {
  return counts.size > 0
}

/**
 * Start/stop the `popstate` listener. The shell owns the lifecycle (like the
 * host bridge registration) so a hot-swapped module doesn't stack listeners.
 */
export function startUiHistory(): void {
  if (popWired || typeof window === "undefined" || !usesBrowserHistory()) return
  popWired = true
  window.addEventListener("popstate", onPopState)
}

export function stopUiHistory(): void {
  cancelPendingPop()
  if (!popWired || typeof window === "undefined") return
  popWired = false
  window.removeEventListener("popstate", onPopState)
}

/**
 * Deferred to a microtask so a close→open transition in one click (menu item
 * that switches to a view) nets out instead of popping and immediately pushing
 * a new entry.
 */
function queueSync(): void {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    syncEntry()
  })
}

function cancelPendingPop(): void {
  if (popTimer === null) return
  clearTimeout(popTimer)
  popTimer = null
}

/**
 * `replacePath` overwrote the sentinel entry in place: release it so closing
 * the layer (or the deferred pop) doesn't navigate away from the new URL.
 */
function releaseEntryForReplace(): void {
  cancelPendingPop()
  entryPushed = false
}

setBeforePathReplace(releaseEntryForReplace)

function syncEntry(): void {
  if (!usesBrowserHistory()) return
  // Our own back is still in flight; the pop handler re-syncs once it lands.
  if (ignorePops > 0) return
  if (anyLayerOpen()) {
    cancelPendingPop()
    if (entryPushed) return
    entryPushed = true
    history.pushState({ inb4docLayer: true }, "")
    return
  }
  if (!entryPushed) return
  schedulePop()
}

/**
 * Wait a macrotask before popping. Closing the last layer is often followed by
 * the caller rewriting the URL (e.g. a rename after its dialog resolves);
 * `replacePath` releases the sentinel first, and the pop must not race it.
 */
function schedulePop(): void {
  if (popTimer !== null) return
  popTimer = setTimeout(() => {
    popTimer = null
    if (!usesBrowserHistory() || !entryPushed || anyLayerOpen() || ignorePops > 0) return
    entryPushed = false
    ignorePops++
    history.back()
  }, 0)
}

function onPopState(): void {
  if (!usesBrowserHistory()) return
  cancelPendingPop()
  if (ignorePops > 0) {
    ignorePops--
    queueSync()
    return
  }
  if (!entryPushed) {
    // A real URL navigation (browser Back/Forward between documents) — the
    // URL already points at the target, so do not push a duplicate entry.
    appEvents.emit(AppEvent.HistoryNavigate, { path: getCurrentPath() })
    return
  }
  // The user pressed Back while layers were open: consume our entry and
  // unwind exactly one layer, then stay in the app if anything remains.
  entryPushed = false
  const handled = handleBack()
  syncQueued = false
  if (handled && anyLayerOpen()) {
    entryPushed = true
    history.pushState({ inb4docLayer: true }, "")
  }
}
