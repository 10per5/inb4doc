import { pageRepository } from "@/repositories/pageRepository";

/**
 * Debounced persistence of the in-memory page cache to localStorage.
 *
 * Extracted from the old dirty plugin so that dirty tracking and storage
 * flushing are decoupled. `DirtyTrackingService` calls `scheduleSave()` after
 * mutations; `flushSave()` is used on navigation, flush, and beforeunload.
 */

const SAVE_DEBOUNCE_MS = 300;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    pageRepository.save();
  }, SAVE_DEBOUNCE_MS);
}

export function flushSave(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  pageRepository.save();
}
