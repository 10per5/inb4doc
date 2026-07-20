/**
 * data-action values for toolbar and toolbar menus.
 */
export const TOOLBAR_ACTION_PREFIX = "tb-";

export enum ToolbarAction {
  ToggleSidebar,
  ToggleHeadingDropdown,
  ExecHeading,
  Exec,
  ToggleMetaPanel,
  FlushAll,
  OpenPrefs,
  MenuItem,
  SourceMode,
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
  [ToolbarAction.ToggleMetaPanel]: "toggleMetaPanel",
  [ToolbarAction.FlushAll]: "flushAll",
  [ToolbarAction.OpenPrefs]: "openPrefs",
  [ToolbarAction.MenuItem]: "menuItem",
  [ToolbarAction.SourceMode]: "sourceMode",
};
