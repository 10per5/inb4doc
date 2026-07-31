import { VERSION_KEY, MIN_STORAGE_VERSION, STORE_FILES } from "@/config/storage-keys"
import { appVersion } from "@/config"
import type { FileEntry } from "@/config/storage-keys"
import type { StorageService } from "@/services/storage"
import type { MigrationContext, MigrationResult } from "./types"
import { registry } from "./registry"

function parseVersion(v: string): [number, number, number] {
  const parts = v.split(/[^\d]/).filter(Boolean)
  if (parts.length < 3) return [0, 0, 0]
  return [parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10)]
}

function versionLt(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0]
  if (a[1] !== b[1]) return a[1] < b[1]
  return a[2] < b[2]
}

function createContext(storage: StorageService): MigrationContext {
  return {
    storage,
    readJSON: (type, id) => storage.getJSON(type, id),
    writeJSON: (type, id, data) => storage.setJSON(type, id, data),
    removeEntity: (type, id) => storage.removeEntity(type, id),
    getAllJSON: (type) => storage.getAllJSON(type),
    forEachProviderFile(cb) {
      storage.forEachFile(cb)
    },
    rewriteProviderFiles(providerId, fn) {
      const files = storage.loadProviderFiles(providerId)
      for (const [path, entry] of Object.entries(files)) {
        const result = fn(path, entry)
        if (result === null) {
          storage.removeEntity(STORE_FILES, `${providerId}/${path}`)
        } else {
          storage.setJSON(STORE_FILES, `${providerId}/${path}`, result as Record<string, unknown>)
        }
      }
    },
  }
}

export async function runMigrations(storage: StorageService): Promise<void> {
  const storedRaw = storage.get(VERSION_KEY)
  if (!storedRaw) {
    storage.set(VERSION_KEY, appVersion)
    return
  }

  const storedVer = parseVersion(storedRaw)
  if (versionLt(storedVer, MIN_STORAGE_VERSION as unknown as [number, number, number])) {
    localStorage.clear()
    storage.set(VERSION_KEY, appVersion)
    return
  }

  const pending = registry.getPath(storedRaw, appVersion)
  if (pending.length === 0) {
    storage.set(VERSION_KEY, appVersion)
    return
  }

  const ctx = createContext(storage)
  for (const migration of pending) {
    const raw = migration.migrate(ctx)
    const result = raw instanceof Promise ? await raw : raw
    if (!result.success) {
      console.error(`Migration ${migration.from}→${migration.to} failed: ${result.error}`)
      throw new Error(`Migration failed: ${result.error}`)
    }
    storage.set(VERSION_KEY, migration.to)
  }

  if (storedRaw !== appVersion) {
    storage.set(VERSION_KEY, appVersion)
  }
}
