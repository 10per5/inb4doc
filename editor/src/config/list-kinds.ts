/**
 * List-kind ↔ ToolbarCommand mapping shared by the topbar list dropdown — the
 * same `.toolbar-list-wrap` / `data-kind` → execList API is used by both the
 * desktop and mobile topbars. Single source of truth so the two modes never
 * drift apart.
 */
import { ToolbarCommand } from "@/config/enums";

export type ListKind = "bullet" | "ordered" | "task" | "checked";

export const LIST_KIND_COMMANDS: Record<ListKind, ToolbarCommand> = {
  bullet: ToolbarCommand.BulletList,
  ordered: ToolbarCommand.OrderedList,
  task: ToolbarCommand.TaskList,
  checked: ToolbarCommand.ToggleTaskChecked,
};
