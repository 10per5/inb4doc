import type { StorageService } from "@/services/storage-service"
import type { FileEntry } from "@/config/storage-keys"

export interface Migration {
  from: string
  to: string
  description: string
  migrate(ctx: MigrationContext): MigrationResult | Promise<MigrationResult>
}

export interface MigrationContext {
  storage: StorageService
  readJSON<T>(type: string, id: string): T | null
  writeJSON<T>(type: string, id: string, data: T): void
  removeEntity(type: string, id: string): void
  getAllJSON<T>(type: string): Array<{ id: string; value: T }>
  forEachProviderFile(cb: (providerId: string, path: string, entry: FileEntry) => void): void
  rewriteProviderFiles(providerId: string, fn: (path: string, entry: FileEntry) => FileEntry | null): void
}

export type MigrationResult = { success: true } | { success: false; error: string }
