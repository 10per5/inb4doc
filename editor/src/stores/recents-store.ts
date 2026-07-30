import { EntityStore } from "@/stores/entity-store"
import { activeProviderId } from "@/stores/provider-store"

const RECENTS_PREFIX = "inb4doc:recents:"

class RecentsStore extends EntityStore<string[]> {
  constructor() {
    super("recents")
  }

  private recentsKey(): string {
    return `${RECENTS_PREFIX}${activeProviderId()}`
  }

  private readRecents(): string[] {
    const cached = this.getFromCache("list")
    if (cached) return cached
    const raw = this.storage.get(this.recentsKey())
    const val: string[] = raw ? JSON.parse(raw) : []
    this.cache.set("list", val)
    return val
  }

  private writeRecents(recents: string[]): void {
    this.cache.set("list", recents)
    this.storage.set(this.recentsKey(), JSON.stringify(recents))
  }

  getRecents(): string[] {
    return this.readRecents()
  }

  addRecent(path: string): void {
    const recents = this.readRecents().filter((p) => p !== path)
    recents.unshift(path)
    this.writeRecents(recents.slice(0, 50))
  }

  clearRecents(): void {
    this.writeRecents([])
  }
}

export const recentsStore = new RecentsStore()
