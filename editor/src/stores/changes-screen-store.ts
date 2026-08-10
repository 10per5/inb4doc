import type { ChangesDialogItem } from "@/controllers/changes-controller"
import type { ChangesDialogActions } from "@/controllers/changes-controller"

export interface ChangesScreenData {
  items: ChangesDialogItem[]
  actions: ChangesDialogActions
}

let current: ChangesScreenData | null = null

// Bridge for the mobile fullview Changes screen: the shell (which owns the
// FileSyncService instance that builds the item list + action closures) stashes
// the data here before switching to the "changes" view; the screen controller
// reads it on activation. Unlike dialog payloads (JSON-serialized into a
// data-* attribute), plain JS events/module state can carry the closures.
export const changesScreenStore = {
  set(data: ChangesScreenData): void {
    current = data
  },
  get(): ChangesScreenData | null {
    return current
  },
}
