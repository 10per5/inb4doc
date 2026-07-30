import { PendingOpType, type PendingOps } from "@/entities/PendingOps";

const TINT_DELETE = "pending-delete-tint";
const TINT_CREATE = "pending-create-tint";

export function updateEditorTint(
  editorEl: HTMLElement,
  path: string,
  pendingOps: PendingOps,
): void {
  editorEl.classList.remove(TINT_DELETE, TINT_CREATE);

  if (pendingOps.all.some(
    o => o.type === PendingOpType.Delete && (o.path === path || path.startsWith(o.path + "/"))
  )) {
    editorEl.classList.add(TINT_DELETE);
    return;
  }

  if (pendingOps.all.some(
    o => o.type === PendingOpType.Create && o.path === path
  )) {
    editorEl.classList.add(TINT_CREATE);
  }
}

export function clearEditorTint(editorEl: HTMLElement): void {
  editorEl.classList.remove(TINT_DELETE, TINT_CREATE);
}
