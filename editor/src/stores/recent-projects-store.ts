import { storageService } from "@/services/storage-service"
import { STORE_RECENT_PROJECTS } from "@/config/storage-keys"

export interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

const LIST_ID = "list"
const MAX_RECENTS = 10

/**
 * Global (not per-provider) recent projects list — the dirs the user opened
 * via File → Open Project… (desktop: filesystem paths; mobile: SAF tree URIs).
 * Follows the storage.ts entity design: key `inb4doc:recent-projects:list`.
 */
class RecentProjectsStore {
  private cache: RecentProject[] | null = null

  private read(): RecentProject[] {
    if (this.cache) return this.cache
    const stored = storageService.getJSON<RecentProject[]>(STORE_RECENT_PROJECTS, LIST_ID)
    this.cache = stored ?? []
    return this.cache
  }

  private write(list: RecentProject[]): void {
    this.cache = list
    storageService.setJSON(STORE_RECENT_PROJECTS, LIST_ID, list)
  }

  list(): RecentProject[] {
    return this.read()
  }

  add(path: string, name?: string): void {
    const now = Date.now()
    const displayName = name ?? basename(path)
    const next = this.read().filter((p) => p.path !== path)
    next.unshift({ path, name: displayName, lastOpened: now })
    this.write(next.slice(0, MAX_RECENTS))
  }

  remove(path: string): void {
    const next = this.read().filter((p) => p.path !== path)
    this.write(next)
  }

  clear(): void {
    this.write([])
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  const slash = trimmed.lastIndexOf("/")
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

export const recentProjectsStore = new RecentProjectsStore()
