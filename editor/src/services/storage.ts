import {
  STORE_FILES,
  STORE_IMAGES,
  type FileEntry,
} from "@/config/storage-keys"

export type ImageStorageMode = "file" | "base64"

export interface WikiPrefs {
  stickyToolbar: boolean
  imageStorageMode: ImageStorageMode
  darkMode: boolean
  hideEmptyFolders: boolean
}

export interface ConnectionConfig {
  host: string
  port: number
}

const META_PREFIX = "inb4doc:meta:"
const ENTITY_PREFIX = "inb4doc:"

type InitHandler = (entries: Array<{ id: string; value: unknown }>) => void
const initHandlers = new Map<string, InitHandler>()

export class StorageService {
  private inited = false

  registerInit(type: string, handler: InitHandler): void {
    initHandlers.set(type, handler)
  }

  async initialize(): Promise<void> {
    if (this.inited) return
    this.inited = true

    await this.ensureVersion()

    for (const [type, handler] of initHandlers) {
      const entries = this.getAllJSON<unknown>(type)
      if (entries.length > 0) {
        handler(entries)
      }
    }
  }

  // ── Raw I/O ──

  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  set(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch {}
  }

  remove(key: string): void {
    try { localStorage.removeItem(key) } catch {}
  }

  keys(prefix: string): string[] {
    const result: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) result.push(key)
    }
    return result
  }

  // ── Key construction ──

  entityKey(type: string, id: string): string {
    return `${ENTITY_PREFIX}${type}:${id}`
  }

  // ── Meta helpers ──

  metaKey(type: string, scope?: string): string {
    return scope ? `${META_PREFIX}${scope}:${type}` : `${META_PREFIX}${type}`
  }

  getMetaIds(type: string, scope?: string): string[] {
    const key = this.metaKey(type, scope)
    const raw = this.get(key)
    if (raw) {
      try { return JSON.parse(raw) } catch { return [] }
    }
    if (scope) {
      const globalRaw = this.get(this.metaKey(type))
      if (globalRaw) {
        try {
          const prefix = scope + "/"
          return JSON.parse(globalRaw)
            .filter((id: string) => id.startsWith(prefix))
            .map((id: string) => id.slice(prefix.length))
        } catch { return [] }
      }
    }
    return []
  }

  metaAdd(type: string, id: string, scope?: string): void {
    const ids = this.getMetaIds(type, scope)
    if (ids.includes(id)) return
    ids.push(id)
    this.set(this.metaKey(type, scope), JSON.stringify(ids))
  }

  metaRemove(type: string, id: string, scope?: string): void {
    const ids = this.getMetaIds(type, scope)
    const next = ids.filter((x) => x !== id)
    if (ids.length === next.length) return
    if (next.length === 0) {
      this.remove(this.metaKey(type, scope))
    } else {
      this.set(this.metaKey(type, scope), JSON.stringify(next))
    }
  }

  // ── JSON entity helpers ──

  getJSON<T>(type: string, id: string): T | null {
    const raw = this.get(this.entityKey(type, id))
    if (!raw) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }

  setJSON<T>(type: string, id: string, data: T): void {
    this.set(this.entityKey(type, id), JSON.stringify(data))
    const sep = id.indexOf("/")
    if (sep !== -1) {
      this.metaAdd(type, id.slice(sep + 1), id.slice(0, sep))
    } else {
      this.metaAdd(type, id)
    }
  }

  removeEntity(type: string, id: string): void {
    this.remove(this.entityKey(type, id))
    const sep = id.indexOf("/")
    if (sep !== -1) {
      this.metaRemove(type, id.slice(sep + 1), id.slice(0, sep))
    } else {
      this.metaRemove(type, id)
    }
  }

  getAllJSON<T>(type: string): Array<{ id: string; value: T }> {
    const global = this.getMetaIds(type)
    if (global.length > 0) {
      return global
        .map((id) => {
          const value = this.getJSON<T>(type, id)
          return value ? { id, value } : null
        })
        .filter(Boolean) as Array<{ id: string; value: T }>
    }
    const results: Array<{ id: string; value: T }> = []
    const prefix = this.entityKey(type, "")
    for (const key of this.keys(prefix)) {
      const id = key.slice(prefix.length)
      const value = this.getJSON<T>(type, id)
      if (value) results.push({ id, value })
    }
    return results
  }

  // ── Provider file helpers ──

  loadProviderFiles(providerId: string): Record<string, FileEntry> {
    const files: Record<string, FileEntry> = {}
    const paths = this.getMetaIds(STORE_FILES, providerId)
    for (const rawPath of paths) {
      let path = rawPath
      if (path.endsWith(".md")) {
        path = path.slice(0, -3)
        const existing = this.getJSON<FileEntry>(STORE_FILES, `${providerId}/${path}`)
        if (existing) continue
        this.setJSON(STORE_FILES, `${providerId}/${path}`, this.getJSON<FileEntry>(STORE_FILES, `${providerId}/${rawPath}`)!)
        this.removeEntity(STORE_FILES, `${providerId}/${rawPath}`)
      }
      const entry = this.getJSON<FileEntry>(STORE_FILES, `${providerId}/${path}`)
      if (entry) files[path] = entry
    }
    return files
  }

  saveProviderFiles(providerId: string, files: Record<string, FileEntry>): void {
    for (const [path, entry] of Object.entries(files)) {
      this.setJSON(STORE_FILES, `${providerId}/${path}`, entry)
    }
  }

  forEachFile(cb: (providerId: string, path: string, entry: FileEntry) => void): void {
    const prefix = this.entityKey(STORE_FILES, "")
    for (const key of this.keys(prefix)) {
      const id = key.slice(prefix.length)
      const sep = id.indexOf("/")
      if (sep === -1) continue
      const providerId = id.slice(0, sep)
      const path = id.slice(sep + 1)
      const entry = this.getJSON<FileEntry>(STORE_FILES, id)
      if (entry) cb(providerId, path, entry)
    }
  }

  // ── Image helpers (binary, not JSON) ──

  getImage(name: string): string | null {
    return this.get(`${ENTITY_PREFIX}image:${name}`)
  }

  setImage(name: string, data: string): void {
    this.set(`${ENTITY_PREFIX}image:${name}`, data)
    this.metaAdd(STORE_IMAGES, name)
  }

  deleteImage(name: string): void {
    this.remove(`${ENTITY_PREFIX}image:${name}`)
    this.metaRemove(STORE_IMAGES, name)
  }

  listImageNames(): string[] {
    const meta = this.getMetaIds(STORE_IMAGES)
    if (meta.length > 0) return meta
    return this.keys(`${ENTITY_PREFIX}image:`).map((k) => k.slice(`${ENTITY_PREFIX}image:`.length))
  }

  // ── Versioning ──

  private async ensureVersion(): Promise<void> {
    const { runMigrations } = await import("@/migrations")
    await runMigrations(this)
  }
}

export const storageService = new StorageService()
