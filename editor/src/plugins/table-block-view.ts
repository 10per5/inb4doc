import { defineNodeView } from "@prosekit/core"
import type { NodeView, ViewMutationRecord } from "prosemirror-view"
import { TableView } from "prosemirror-tables"

const TABLE_DRAG_HANDLE =
  '[data-role="col-drag-handle"], [data-role="row-drag-handle"]'

class FixedTableView extends TableView {
  stopEvent(e: Event): boolean {
    if (e.type === "dragstart") {
      const target = e.target as Element | null
      if (target?.closest(TABLE_DRAG_HANDLE)) return true
      return false
    }
    if (
      e.type.startsWith("drag") ||
      e.type === "drop"
    ) {
      return false
    }
    return false
  }
}

export const fixedTableBlockView = defineNodeView({
  name: "table",
  constructor: (node, _view, _getPos): NodeView => {
    const tableView = new FixedTableView(node, 100)
    return {
      dom: tableView.dom,
      contentDOM: tableView.contentDOM,
      update: (updatedNode) => {
        if (updatedNode.type.name !== "table") return false
        tableView.update(updatedNode)
        return true
      },
      stopEvent: (e) => (tableView as any).stopEvent?.(e) ?? false,
      ignoreMutation: (record: ViewMutationRecord) =>
        (tableView as any).ignoreMutation?.(record) ?? false,
      destroy: () => {
        if ("destroy" in tableView) (tableView as any).destroy();
      },
    }
  },
})
