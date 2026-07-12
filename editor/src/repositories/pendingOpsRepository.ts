import { savePendingOps, loadPendingOps, clearPendingOpsStorage } from "@/utils/storage"
import { getProvider } from "@/stores/provider-store"
import type { PendingOp } from "@/entities/PendingOps"

function providerKey(): string {
  try { return getProvider().name } catch { return "" }
}

export const pendingOpsRepository = {
  load(): PendingOp[] {
    return loadPendingOps<PendingOp[]>(providerKey())
  },

  save(ops: PendingOp[]): void {
    savePendingOps(ops, providerKey())
  },

  clear(): void {
    clearPendingOpsStorage(providerKey())
  },
}
