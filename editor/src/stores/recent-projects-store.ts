import { storageService } from "@/services/storage-service"
import { STORE_RECENT_PROJECTS } from "@/config/storage-keys"

export interface RecentProject {
  path: string
  name: string
  lastOpened: number
  /** Document last open in this project — reopened when you switch back. */
  lastFile?: string
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
    const existing = this.read().find((p) => p.path === path)
    const next = this.read().filter((p) => p.path !== path)
    next.unshift({
      path,
      name: displayName,
      lastOpened: now,
      ...(existing?.lastFile ? { lastFile: existing.lastFile } : {}),
    })
    this.write(next.slice(0, MAX_RECENTS))
  }

  /**
   * Remember which document was open in a project so switching back lands on
   * it instead of the home page. Keyed by the content root, so every project
   * keeps its own "you were here".
   */
  setLastFile(projectPath: string, file: string): void {
    if (!projectPath || !file) return
    const list = this.read()
    let entry = list.find((p) => p.path === projectPath)
    if (!entry) {
      entry = { path: projectPath, name: basename(projectPath), lastOpened: Date.now() }
      list.unshift(entry)
    }
    entry.lastFile = file
    entry.lastOpened = Math.max(entry.lastOpened, Date.now())
    this.write(list.slice(0, MAX_RECENTS))
  }

  getLastFile(projectPath: string): string | undefined {
    return this.read().find((p) => p.path === projectPath)?.lastFile
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
