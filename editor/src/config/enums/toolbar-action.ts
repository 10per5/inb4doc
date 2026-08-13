/**
 * data-action values for toolbar and toolbar menus.
 */
export const TOOLBAR_ACTION_PREFIX = "tb-";

export enum ToolbarAction {
  ToggleSidebar,
  ToggleHeadingDropdown,
  ExecHeading,
  Exec,
  FlushAll,
  OpenPrefs,
  MenuItem,
  SourceMode,
  ToggleListDropdown,
  ExecList,
  ToggleOverflowDropdown,
}

/**
 * Map from ToolbarAction int → Stimulus action method name (string).
 * Passed into the topbar template so it can emit `click->topbar#<method>`
 * attributes directly, e.g. `it.toolbarActions[it.ToolbarAction.Exec]`.
 */
export const toolbarActions: Record<ToolbarAction, string> = {
  [ToolbarAction.ToggleSidebar]: "toggleSidebar",
  [ToolbarAction.ToggleHeadingDropdown]: "toggleHeadingDropdown",
  [ToolbarAction.ExecHeading]: "execHeading",
  [ToolbarAction.Exec]: "execCommand",
  [ToolbarAction.FlushAll]: "flushAll",
  [ToolbarAction.OpenPrefs]: "openPrefs",
  [ToolbarAction.MenuItem]: "menuItem",
  [ToolbarAction.SourceMode]: "sourceMode",
  [ToolbarAction.ToggleListDropdown]: "toggleListDropdown",
  [ToolbarAction.ExecList]: "execList",
  [ToolbarAction.ToggleOverflowDropdown]: "toggleOverflowDropdown",
};
