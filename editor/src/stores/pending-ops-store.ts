import type { PendingOp } from "@/entities/PendingOps"
import { storageService } from "@/services/storage"
import { STORE_PENDING_OPS } from "@/config/storage-keys"
import { activeProviderId } from "@/stores/provider-store"

class PendingOpsStore {
  private cache = new Map<string, PendingOp>()

  private providerPrefix(): string {
    return activeProviderId() + "/"
  }

  private opId(path: string): string {
    return this.providerPrefix() + path
  }

  constructor() {
    storageService.registerInit(STORE_PENDING_OPS, (entries) => {
      for (const { id, value } of entries) {
        if (Array.isArray(value)) {
          // Old single-blob format — migrate to per-path entries
          const prefix = id + "/"
          for (const op of value as PendingOp[]) {
            const path = "path" in op ? op.path : op.from
            const entryId = prefix + path
            storageService.setJSON(STORE_PENDING_OPS, entryId, op)
            this.cache.set(entryId, op)
          }
          storageService.removeEntity(STORE_PENDING_OPS, id)
        } else {
          this.cache.set(id, value as PendingOp)
        }
      }
    })
  }

  load(): PendingOp[] {
    const prefix = this.providerPrefix()
    const found: PendingOp[] = []
    for (const [id, op] of this.cache) {
      if (id.startsWith(prefix)) {
        found.push(op)
      }
    }
    if (found.length > 0) return found

    const paths = storageService.getMetaIds(STORE_PENDING_OPS, activeProviderId())
    for (const path of paths) {
      const id = this.opId(path)
      const op = storageService.getJSON<PendingOp>(STORE_PENDING_OPS, id)
      if (op) {
        this.cache.set(id, op)
        found.push(op)
      }
    }
    return found
  }

  save(ops: readonly PendingOp[]): void {
    const providerId = activeProviderId()
    this.clear()

    // Remove old single-blob entry if it still exists
    storageService.removeEntity(STORE_PENDING_OPS, providerId)

    for (const op of ops) {
      const path = "path" in op ? op.path : op.from
      const id = this.opId(path)
      this.cache.set(id, op)
      storageService.setJSON(STORE_PENDING_OPS, id, op)
    }
  }

  clear(): void {
    const prefix = this.providerPrefix()
    const toRemove: string[] = []
    for (const [id] of this.cache) {
      if (id.startsWith(prefix)) toRemove.push(id)
    }
    for (const id of toRemove) {
      this.cache.delete(id)
      storageService.removeEntity(STORE_PENDING_OPS, id)
    }
  }
}

export const pendingOpsStore = new PendingOpsStore()
