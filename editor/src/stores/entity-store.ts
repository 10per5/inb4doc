import { storageService, type StorageService } from "@/services/storage-service"
import { appEvents, AppEvent } from "@/stores/app-events"

export abstract class EntityStore<T> {
  protected cache = new Map<string, T>()
  protected storage: StorageService = storageService
  readonly type: string

  private pending = new Set<string>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private debounceMs: number
  private handleNavigate: (() => void) | null = null

  constructor(type: string, options?: { debounceMs?: number; autoFlush?: boolean }) {
    this.type = type
    this.debounceMs = options?.debounceMs ?? 500
    this.storage.registerInit(type, (entries) => {
      for (const { id, value } of entries) {
        this.cache.set(id, value as T)
      }
      this.onInit()
    })
    if (options?.autoFlush) {
      this.handleNavigate = () => this.flush()
      appEvents.on(AppEvent.Navigate, this.handleNavigate)
    }
  }

  protected getFromCache(id: string): T | undefined {
    return this.cache.get(id)
  }

  protected getAllFromCache(): T[] {
    return Array.from(this.cache.values())
  }

  protected persist(id: string, data: T): void {
    this.cancelPending(id)
    this.cache.set(id, data)
    this.storage.setJSON(this.type, id, data)
  }

  protected persistDebounced(id: string, data: T): void {
    this.cache.set(id, data)
    this.pending.add(id)
    const existing = this.debounceTimers.get(id)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(id, setTimeout(() => this.flushOne(id), this.debounceMs))
  }

  protected removeFromStore(id: string): void {
    this.cancelPending(id)
    this.cache.delete(id)
    this.storage.removeEntity(this.type, id)
  }

  flush(): void {
    for (const id of this.pending) this.flushOne(id)
  }

  protected onInit(): void {
    // subclasses may override
  }

  private flushOne(id: string): void {
    const timer = this.debounceTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(id)
    }
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    const data = this.cache.get(id)
    if (data !== undefined) {
      this.storage.setJSON(this.type, id, data)
    }
  }

  private cancelPending(id: string): void {
    const timer = this.debounceTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(id)
    }
    this.pending.delete(id)
  }
}
