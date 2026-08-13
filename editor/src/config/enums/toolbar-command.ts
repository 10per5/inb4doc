/**
 * Toolbar formatting command identifiers used in data-cmd attributes
 * and dispatched to Milkdown editor commands.
 */
export const TOOLBAR_CMD_PREFIX = "tc-";

export enum ToolbarCommand {
  Bold,
  Italic,
  Strike,
  Code,
  Hr,
  Link,
  Heading,
  Indent,
  Unindent,
  MarkTask,
  UnmarkTask,
  BulletList,
  TaskList,
  OrderedList,
  AddRow,
  AddCol,
  RemoveRow,
  DeleteCol,
  RemoveTable,
  Undo,
  Redo,
  Blockquote,
  ToggleTaskChecked,
  ExitList,
}
