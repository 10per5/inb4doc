/**
 * Table handles — floating row/column grips built on @prosekit/web's
 * table-handle custom elements (see https://prosekit.dev/components/table-handle/).
 *
 * Mounts the element tree into #inb4doc-editor (view.dom.parentNode), wires
 * each menu item to a table command, and keeps item disabled state in sync
 * with canExec on every doc update.
 */

import { definePlugin, type Editor } from "@prosekit/core";
import { Plugin, PluginKey } from "prosemirror-state";
import {
  TableHandleRootElement,
  TableHandleDragPreviewElement,
  TableHandleDropIndicatorElement,
  TableHandleColumnPositionerElement,
  TableHandleColumnPopupElement,
  TableHandleColumnMenuRootElement,
  TableHandleColumnMenuTriggerElement,
  TableHandleRowPositionerElement,
  TableHandleRowPopupElement,
  TableHandleRowMenuRootElement,
  TableHandleRowMenuTriggerElement,
  registerTableHandleRootElement,
  registerTableHandleDragPreviewElement,
  registerTableHandleDropIndicatorElement,
  registerTableHandleColumnPositionerElement,
  registerTableHandleColumnPopupElement,
  registerTableHandleColumnMenuRootElement,
  registerTableHandleColumnMenuTriggerElement,
  registerTableHandleRowPositionerElement,
  registerTableHandleRowPopupElement,
  registerTableHandleRowMenuRootElement,
  registerTableHandleRowMenuTriggerElement,
} from "@prosekit/web/table-handle";
import {
  MenuPositionerElement,
  MenuPopupElement,
  MenuItemElement,
  registerMenuPositionerElement,
  registerMenuPopupElement,
  registerMenuItemElement,
} from "@prosekit/web/menu";
import { defineTableCommands } from "@prosekit/extensions/table";
import { menuScale } from "@/eta/icons";

type TableCommandsExtension = ReturnType<typeof defineTableCommands>;

const TRIGGER_CLASS = "table-handle-trigger";

// Custom elements can only be constructed with `new` after their tag has
// been defined; each register function is idempotent (module-level flag).
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerTableHandleRootElement();
  registerTableHandleDragPreviewElement();
  registerTableHandleDropIndicatorElement();
  registerTableHandleColumnPositionerElement();
  registerTableHandleColumnPopupElement();
  registerTableHandleColumnMenuRootElement();
  registerTableHandleColumnMenuTriggerElement();
  registerTableHandleRowPositionerElement();
  registerTableHandleRowPopupElement();
  registerTableHandleRowMenuRootElement();
  registerTableHandleRowMenuTriggerElement();
  registerMenuPositionerElement();
  registerMenuPopupElement();
  registerMenuItemElement();
}

interface HandleAction {
  item: MenuItemElement;
  canExec: () => boolean;
}

function createMenuItem(label: string, opts: { danger?: boolean; hint?: string } = {}): MenuItemElement {
  const item = new MenuItemElement();
  if (opts.danger) item.classList.add("danger");
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  item.appendChild(labelEl);
  if (opts.hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "table-handle-hint";
    hintEl.textContent = opts.hint;
    item.appendChild(hintEl);
  }
  return item;
}

function createMenu(
  editor: Editor<TableCommandsExtension>,
  actions: Array<{ build: () => MenuItemElement; run: () => void; canExec: () => boolean }>,
): { positioner: MenuPositionerElement; tracked: HandleAction[] } {
  const positioner = new MenuPositionerElement();
  positioner.className = "table-handle-menu-positioner";
  const popup = new MenuPopupElement();
  popup.className = "table-handle-menu";
  const tracked: HandleAction[] = [];

  for (const action of actions) {
    const item = action.build();
    item.addEventListener("select", () => {
      if (!action.canExec()) return;
      editor.view.focus();
      action.run();
    });
    tracked.push({ item, canExec: action.canExec });
    popup.appendChild(item);
  }

  positioner.appendChild(popup);
  return { positioner, tracked };
}

export function setupTableHandleUI(editor: Editor<TableCommandsExtension>): () => void {
  ensureRegistered();
  const parent = editor.view.dom.parentNode;
  if (!parent) return () => {};

  const root = new TableHandleRootElement();
  root.editor = editor;

  const dragPreview = new TableHandleDragPreviewElement();
  dragPreview.editor = editor;
  const dropIndicator = new TableHandleDropIndicatorElement();
  dropIndicator.editor = editor;

  const column = new TableHandleColumnPositionerElement();
  column.editor = editor;
  const columnPopup = new TableHandleColumnPopupElement();
  const columnMenuRoot = new TableHandleColumnMenuRootElement();
  const columnTrigger = new TableHandleColumnMenuTriggerElement();
  columnTrigger.classList.add(TRIGGER_CLASS);
  columnTrigger.editor = editor;
  columnTrigger.innerHTML = menuScale;
  columnMenuRoot.appendChild(columnTrigger);

  const columnMenu = createMenu(editor, [
    { build: () => createMenuItem("Insert Left"), run: () => editor.commands.addTableColumnBefore(), canExec: () => editor.commands.addTableColumnBefore.canExec() },
    { build: () => createMenuItem("Insert Right"), run: () => editor.commands.addTableColumnAfter(), canExec: () => editor.commands.addTableColumnAfter.canExec() },
    { build: () => createMenuItem("Clear Contents", { hint: "Del" }), run: () => editor.commands.deleteCellSelection(), canExec: () => editor.commands.deleteCellSelection.canExec() },
    { build: () => createMenuItem("Delete Column", { danger: true }), run: () => editor.commands.deleteTableColumn(), canExec: () => editor.commands.deleteTableColumn.canExec() },
    { build: () => createMenuItem("Delete Table", { danger: true }), run: () => editor.commands.deleteTable(), canExec: () => editor.commands.deleteTable.canExec() },
  ]);
  columnMenuRoot.appendChild(columnMenu.positioner);
  columnPopup.appendChild(columnMenuRoot);
  column.appendChild(columnPopup);

  const row = new TableHandleRowPositionerElement();
  row.editor = editor;
  row.placement = "left";
  const rowPopup = new TableHandleRowPopupElement();
  const rowMenuRoot = new TableHandleRowMenuRootElement();
  const rowTrigger = new TableHandleRowMenuTriggerElement();
  rowTrigger.classList.add(TRIGGER_CLASS);
  rowTrigger.editor = editor;
  rowTrigger.innerHTML = menuScale;
  rowMenuRoot.appendChild(rowTrigger);

  const rowMenu = createMenu(editor, [
    { build: () => createMenuItem("Insert Above"), run: () => editor.commands.addTableRowAbove(), canExec: () => editor.commands.addTableRowAbove.canExec() },
    { build: () => createMenuItem("Insert Below"), run: () => editor.commands.addTableRowBelow(), canExec: () => editor.commands.addTableRowBelow.canExec() },
    { build: () => createMenuItem("Clear Contents", { hint: "Del" }), run: () => editor.commands.deleteCellSelection(), canExec: () => editor.commands.deleteCellSelection.canExec() },
    { build: () => createMenuItem("Delete Row", { danger: true }), run: () => editor.commands.deleteTableRow(), canExec: () => editor.commands.deleteTableRow.canExec() },
    { build: () => createMenuItem("Delete Table", { danger: true }), run: () => editor.commands.deleteTable(), canExec: () => editor.commands.deleteTable.canExec() },
  ]);
  rowMenuRoot.appendChild(rowMenu.positioner);
  rowPopup.appendChild(rowMenuRoot);
  row.appendChild(rowPopup);

  root.appendChild(dragPreview);
  root.appendChild(dropIndicator);
  root.appendChild(column);
  root.appendChild(row);

  const trackedActions = [...columnMenu.tracked, ...rowMenu.tracked];
  const refresh = () => {
    for (const action of trackedActions) {
      action.item.disabled = !action.canExec();
    }
  };
  refresh();

  // ProseKit's Editor exposes no event emitter; a plugin view's update hook
  // fires on every state change (doc, selection, cell selection), which is
  // exactly when canExec can flip.
  const disposeWatcher = editor.use(
    definePlugin([
      new Plugin({
        key: new PluginKey("inb4doc-table-handle-ui"),
        view: () => ({ update: () => refresh() }),
      }),
    ]),
  );

  parent.appendChild(root);

  return () => {
    disposeWatcher?.();
    root.remove();
  };
}

