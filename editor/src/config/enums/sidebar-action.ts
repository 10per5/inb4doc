/**
 * data-action values for the sidebar.
 */
export enum SidebarAction {
  // Sidebar controller actions (method names match controller methods)
  ChangeProvider,
  SearchInput,
  SearchClear,
  NewPage,
  Navigate,
  ShowMenu,
  ToggleSection,
}

/**
 * Int-based prefix for sidebar data-action values (e.g. `sb-0`).
 * Used by non-Stimulus code (empty-project-view.ts).
 */
export const SIDEBAR_ACTION_PREFIX = "sb-";

/**
 * Map from SidebarAction int → Stimulus action method name.
 * Passed into sidebar.eta template and used by renderItems() in sidebar.ts.
 */
export const sidebarActions: Record<SidebarAction, string> = {
  [SidebarAction.ChangeProvider]: "onChangeProvider",
  [SidebarAction.SearchInput]: "onSearchInput",
  [SidebarAction.SearchClear]: "onSearchClear",
  [SidebarAction.NewPage]: "onNewPage",
  [SidebarAction.Navigate]: "onNavigate",
  [SidebarAction.ShowMenu]: "onShowMenu",
  [SidebarAction.ToggleSection]: "onToggleSection",
};
