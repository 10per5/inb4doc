import { TableNodeView } from "@milkdown/kit/component/table-block";
import { tableSchema } from "@milkdown/kit/preset/gfm";
import { $view } from "@milkdown/utils";

const TABLE_DRAG_HANDLE =
  '[data-role="col-drag-handle"], [data-role="row-drag-handle"]';

/**
 * Milkdown's stock `tableBlock` node view returns `true` from `stopEvent` for
 * every drag/drop event that starts inside a table (see
 * `table-block/index.js` `stopEvent`). ProseMirror's `eventBelongsToView`
 * then rejects those events, so PM's own dragstart/drop handlers never run
 * over tables:
 *
 * - Drops INTO a table are handled by our own drop listener
 *   (`editor-drag-drop.ts`), which is why that direction works.
 * - Drags STARTING inside a table never install `view.dragging`, and the
 *   component's root div additionally cancels `dragstart` with
 *   `preventDefault` — so nothing can be dragged OUT of a table. This is a
 *   known Milkdown/ProseMirror limitation (it also affects Milkdown's Crepe
 *   editor); see tiptap#3199 for the canonical write-up.
 *
 * We can't patch node_modules, but the package exports `TableNodeView`, so we
 * subclass it and relax only the `dragstart` branch: drags on the row/column
 * drag handles keep the tableBlock row/col move feature (stopEvent true),
 * while drags on cell content no longer get swallowed, so PM's machinery is
 * not the blocker for them. `drop`/`dragover` stay swallowed on purpose so
 * cell drops keep going through `editor-drag-drop.ts`.
 *
 * The actual drag-OUT of an in-cell image is driven by the capture-phase
 * `dragstart` handler in `image-inline-resize.ts` (which stops the root
 * div's `preventDefault` and seeds `view.dragging`).
 */
class FixedTableNodeView extends TableNodeView {
  stopEvent(e: Event): boolean {
    if (e.type === "dragstart") {
      const target = e.target as Element | null;
      if (target?.closest(TABLE_DRAG_HANDLE)) return true;
      return false;
    }
    return super.stopEvent(e);
  }
}

export const fixedTableBlockView = $view(tableSchema.node, (ctx) => {
  return (initialNode, view, getPos) => {
    return new FixedTableNodeView(ctx, initialNode, view, getPos);
  };
});
