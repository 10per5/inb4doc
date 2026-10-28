import { appEvents, AppEvent } from "@/stores/app-events"
import { recentsStore } from "@/stores/recents-store"

/**
 * Ctrl+Tab document cycling (desktop shell only).
 *
 * The list is snapshotted on the first press of a burst: navigating re-writes
 * recents (the opened file jumps to the front), so walking the live list would
 * bounce between two documents. A quiet gap starts a fresh snapshot.
 */
const CYCLE_WINDOW_MS = 2500

let snapshot: string[] = []
let cursor = 0
let lastAt = 0

export function cycleRecentDoc(delta = 1): void {
  const now = Date.now()
  const fresh = now - lastAt > CYCLE_WINDOW_MS
  lastAt = now

  if (fresh || snapshot.length === 0) {
    snapshot = recentsStore.getRecents()
    cursor = 0
  }
  if (snapshot.length < 2) return

  cursor = ((cursor + delta) % snapshot.length + snapshot.length) % snapshot.length
  const target = snapshot[cursor]
  if (!target) return
  appEvents.emit(AppEvent.Navigate, { path: target })
}
