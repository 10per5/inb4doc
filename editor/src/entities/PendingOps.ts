import type { TreeIndex } from "@/utils/tree"
import { applyPendingOps } from "@/utils/tree"

export enum PendingOpType {
  Create = "create",
  Delete = "delete",
  Rename = "rename",
  Move = "move",
  Edit = "edit",
}

export type PendingOp =
  | { type: PendingOpType.Create; path: string; content: string }
  | { type: PendingOpType.Delete; path: string }
  | { type: PendingOpType.Rename; from: string; to: string; content?: string }
  | { type: PendingOpType.Move; from: string; to: string; content?: string }
  | { type: PendingOpType.Edit; path: string; patch: string; frontmatterPatch?: Record<string, string | number | undefined>; serverTime?: number }

function opId(op: PendingOp): string {
  return "path" in op ? op.path : op.from
}

export class PendingOps {
  private ops = new Map<string, PendingOp>()

  constructor(saved?: PendingOp[]) {
    if (Array.isArray(saved)) {
      for (const op of saved) {
        this.ops.set(opId(op), op)
      }
    }
  }

  get all(): readonly PendingOp[] { return [...this.ops.values()] }
  get count(): number { return this.ops.size }

  add(op: PendingOp): void {
    this.ops.set(opId(op), op)
  }

  remove(id: string): void {
    this.ops.delete(id)
  }

  get<T extends PendingOp>(id: string): T | undefined {
    return this.ops.get(id) as T | undefined
  }

  findCreate(path: string): PendingOp & { type: PendingOpType.Create } | undefined {
    const op = this.ops.get(path)
    return op?.type === PendingOpType.Create ? op as any : undefined
  }

  findEdit(path: string): PendingOp & { type: PendingOpType.Edit } | undefined {
    const op = this.ops.get(path)
    return op?.type === PendingOpType.Edit ? op as any : undefined
  }

  getDirtyPaths(): string[] {
    const paths: string[] = []
    for (const [id, op] of this.ops) {
      if (op.type === PendingOpType.Edit) paths.push(id)
    }
    return paths
  }

  listByType<T extends PendingOp>(type: PendingOpType): T[] {
    return [...this.ops.values()].filter(o => o.type === type) as T[]
  }

  queueCreate(path: string, content: string): void {
    const existing = this.ops.get(path)
    if (existing?.type === PendingOpType.Delete) {
      this.ops.delete(path)
    } else {
      this.ops.set(path, { type: PendingOpType.Create, path, content })
    }
  }

  queueDelete(path: string): void {
    const existing = this.ops.get(path)
    if (existing?.type === PendingOpType.Create) {
      this.ops.delete(path)
    } else {
      this.ops.set(path, { type: PendingOpType.Delete, path })
    }
    if (!path.endsWith("/_index")) {
      const prefix = path + "/"
      for (const [id, op] of this.ops) {
        if (op.type === PendingOpType.Create && id.startsWith(prefix)) {
          this.ops.delete(id)
        }
      }
    }
  }

  queueRename(from: string, to: string, content?: string): void {
    this.ops.set(from, { type: PendingOpType.Rename, from, to, ...(content ? { content } : {}) })
  }

  queueMove(from: string, to: string, content?: string): void {
    this.ops.set(from, { type: PendingOpType.Move, from, to, ...(content ? { content } : {}) })
  }

  queueEdit(path: string, patch: string, frontmatterPatch?: Record<string, string | number | undefined>, serverTime?: number): void {
    const op: PendingOp & { type: PendingOpType.Edit } = { type: PendingOpType.Edit, path, patch }
    if (frontmatterPatch) op.frontmatterPatch = frontmatterPatch
    if (serverTime !== undefined) op.serverTime = serverTime
    this.ops.set(path, op)
  }

  cancelCreate(path: string): void {
    const existing = this.ops.get(path)
    if (existing?.type === PendingOpType.Create) {
      this.ops.delete(path)
    }
  }

  cancelEdit(path: string): void {
    const existing = this.ops.get(path)
    if (existing?.type === PendingOpType.Edit) {
      this.ops.delete(path)
    }
  }

  cancelOp(path: string): void {
    this.ops.delete(path)
  }

  hasPendingDelete(path: string): boolean {
    return this.ops.get(path)?.type === PendingOpType.Delete
  }

  hasPendingCreate(path: string): boolean {
    return this.ops.get(path)?.type === PendingOpType.Create
  }

  hasPendingMoveTo(path: string): boolean {
    for (const op of this.ops.values()) {
      if ((op.type === PendingOpType.Move || op.type === PendingOpType.Rename) && "to" in op && op.to === path) return true
    }
    return false
  }

  hasPendingEdit(path: string): boolean {
    return this.ops.get(path)?.type === PendingOpType.Edit
  }

  hasPendingOp(path: string): boolean {
    const op = this.ops.get(path)
    if (!op) return false
    return op.type !== PendingOpType.Delete
  }

  clear(): void {
    this.ops.clear()
  }

  applyToTree(tree: TreeIndex): TreeIndex {
    return applyPendingOps(tree, this.all)
  }
}
