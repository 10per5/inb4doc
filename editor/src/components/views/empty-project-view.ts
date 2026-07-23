/**
 * Empty project view — shown when the project has no files.
 *
 * Replaces the invasive auto-create-_index behavior.
 * Gives the user a clear action: create their first page.
 */

import renderEmptyProject from "@/eta/views/empty-project"

const ACTIONS = {
  createPage: "createPage",
  changeProvider: "changeProvider",
} as const

export function mountEmptyProjectView(container: HTMLElement): void {
  const existing = container.querySelector(".empty-project")
  if (existing) existing.remove()

  container.insertAdjacentHTML("beforeend", renderEmptyProject({ actions: ACTIONS }))
}
