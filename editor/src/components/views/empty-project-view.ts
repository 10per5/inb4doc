/**
 * Empty project view — shown when the project has no files.
 *
 * Replaces the invasive auto-create-_index behavior.
 * Gives the user a clear action: create their first page.
 */

import { ProjectAction, PROJECT_ACTION_PREFIX, SidebarAction, SIDEBAR_ACTION_PREFIX } from "@/config/enums"
import renderEmptyProject from "@/eta/views/empty-project"

export function mountEmptyProjectView(container: HTMLElement): void {
  const existing = container.querySelector(".empty-project")
  if (existing) existing.remove()

  container.insertAdjacentHTML("beforeend", renderEmptyProject({
    PROJECT_ACTION_PREFIX,
    SIDEBAR_ACTION_PREFIX,
    ProjectAction,
    SidebarAction,
  }))
}
