/**
 * Empty project view — shown when the project has no files.
 *
 * Replaces the invasive auto-create-_index behavior.
 * Gives the user a clear action: create their first page.
 */

import { appEvents, AppEvent } from "@/stores/app-events"
import { ProjectAction, PROJECT_ACTION_PREFIX, SidebarAction, SIDEBAR_ACTION_PREFIX } from "@/config/enums"

const styles = `
  <style>
    .empty-project {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; min-height: 400px; text-align: center; padding: 2rem;
      color: var(--color-text-secondary);
    }
    .empty-project h2 {
      font-size: 1.3rem; font-weight: 600; margin: 0 0 0.5rem;
      color: var(--color-text-primary);
    }
    .empty-project p { margin: 0 0 1.5rem; max-width: 360px; line-height: 1.5; }
    .empty-project .btn-row { display: flex; gap: 0.75rem; }
    .empty-project .create-btn {
      padding: 0.6rem 1.6rem; border-radius: 6px; border: none;
      background: var(--color-accent); color: #fff; font-size: 0.95rem;
      cursor: pointer; font-weight: 500;
    }
    .empty-project .create-btn:hover { background: var(--color-accent-hover); }
    .empty-project .change-btn {
      padding: 0.6rem 1.6rem; border-radius: 6px;
      border: 1px solid var(--color-border); background: transparent;
      color: var(--color-text-secondary); font-size: 0.95rem; cursor: pointer;
    }
    .empty-project .change-btn:hover {
      border-color: var(--color-accent); color: var(--color-text-primary);
    }
  </style>
`

export function mountEmptyProjectView(container: HTMLElement): void {
  const tmpl = `
    ${styles}
    <div class="empty-project">
      <h2>Current project is empty</h2>
      <p>Create your first page to get started. You can always add more from the sidebar.</p>
      <div class="btn-row">
        <button class="create-btn" data-action="${PROJECT_ACTION_PREFIX}${ProjectAction.CreatePage}">Create a page</button>
        <button class="change-btn" data-action="${SIDEBAR_ACTION_PREFIX}${SidebarAction.ChangeProvider}">Change provider</button>
      </div>
    </div>
  `
  container.innerHTML = tmpl

  container.querySelector(`[data-action="${PROJECT_ACTION_PREFIX}${ProjectAction.CreatePage}"]`)?.addEventListener("click", () => {
    appEvents.emit(AppEvent.CreateFirstPage)
  })
  container.querySelector(`[data-action="${SIDEBAR_ACTION_PREFIX}${SidebarAction.ChangeProvider}"]`)?.addEventListener("click", () => {
    appEvents.emit(AppEvent.ProviderChangeRequested)
  })
}
