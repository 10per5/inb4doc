/**
 * No-file view — shown when no file is selected.
 *
 * Replaces the empty-project view with a unified landing that adapts:
 *   - Tree empty → "No files yet" + create/change provider buttons
 *   - Tree has files, none selected → recent files + neighbors
 */

import renderNoFile from "@/eta/views/no-file"

export interface NoFileViewData {
  isEmpty: boolean
  recents: string[]
  suggestions: string[]
}

export function mountNoFileView(container: HTMLElement, data: NoFileViewData): void {
  const existing = container.querySelector(".no-file-view")
  if (existing) existing.remove()

  container.insertAdjacentHTML("beforeend", renderNoFile(data as unknown as Record<string, unknown>))
}
