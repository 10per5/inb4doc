import type { TreeNode } from "@/components/panels/sidebar"
import { applyPendingOps } from "@/utils/tree"

export enum PendingOpType {
  Create = "create",
  Delete = "delete",
  Rename = "rename",
  Move = "move",
}

export type PendingOp =
  | { type: PendingOpType.Create; path: string; content: string }
  | { type: PendingOpType.Delete; path: string }
  | { type: PendingOpType.Rename; from: string; to: string; content?: string }
  | { type: PendingOpType.Move; from: string; to: string; content?: string }

/**
 * Queue of file operations (create / delete / rename / move) that have been
 * requested by the user but not yet flushed to the provider.
 *
 * Owns cancel logic (create cancels delete and vice-versa), persistence
 * delegation, and tree application.
 */
export class PendingOps {
  private ops: PendingOp[]

  constructor(saved?: PendingOp[]) {
    this.ops = Array.isArray(saved) && saved.length > 0 ? [...saved] : []
  }

  get all(): PendingOp[] { return this.ops }
  get count(): number { return this.ops.length }

  queueCreate(path: string, content: string): void {
    const delIdx = this.ops.findIndex(o => o.type === PendingOpType.Delete && o.path === path)
    if (delIdx !== -1) {
      this.ops.splice(delIdx, 1)
    } else {
      this.ops.push({ type: PendingOpType.Create, path, content })
    }
  }

  queueDelete(path: string): void {
    const createIdx = this.ops.findIndex(o => o.type === PendingOpType.Create && o.path === path)
    if (createIdx !== -1) {
      this.ops.splice(createIdx, 1)
    } else {
      this.ops.push({ type: PendingOpType.Delete, path })
    }
  }

  queueRename(from: string, to: string, content?: string): void {
    this.ops.push({ type: PendingOpType.Rename, from, to, ...(content ? { content } : {}) })
  }

  queueMove(from: string, to: string, content?: string): void {
    this.ops.push({ type: PendingOpType.Move, from, to, ...(content ? { content } : {}) })
  }

  clear(): void {
    this.ops = []
  }

  hasPendingDelete(path: string): boolean {
    return this.ops.some(o => o.type === PendingOpType.Delete && o.path === path)
  }

  hasPendingCreate(path: string): boolean {
    return this.ops.some(o => o.type === PendingOpType.Create && o.path === path)
  }

  hasPendingMoveTo(path: string): boolean {
    return this.ops.some(o => (o.type === PendingOpType.Move || o.type === PendingOpType.Rename) && o.to === path)
  }

  cancelCreate(path: string): void {
    const idx = this.ops.findIndex(o => o.type === PendingOpType.Create && o.path === path)
    if (idx !== -1) this.ops.splice(idx, 1)
  }

  applyToTree(tree: TreeNode): TreeNode {
    return applyPendingOps(tree, this.ops)
  }
}
