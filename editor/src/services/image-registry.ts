import { savePendingImage, loadAllPendingImages, removePendingImageById, clearAllPendingImages } from "./pending-images-db"

interface PendingImage {
  id: string
  file: File
  blobUrl: string
  dir: string
}

interface KnownImage {
  name: string
  url: string
  storageUrl: string
  usedIn: string[]
}

class ImageRegistry {
  private pendingByDir = new Map<string, PendingImage[]>()
  private knownByDir = new Map<string, KnownImage[]>()
  private counter = 0

  async restoreFromStorage(): Promise<void> {
    const records = await loadAllPendingImages()
    for (const r of records) {
      const blobUrl = URL.createObjectURL(r.file)
      const list = this.pendingByDir.get(r.dir) || []
      list.push({ id: r.id, file: r.file, blobUrl, dir: r.dir })
      this.pendingByDir.set(r.dir, list)
      if (r.id.startsWith("pi-")) {
        const num = parseInt(r.id.slice(3), 10)
        if (num > this.counter) this.counter = num
      }
    }
  }

  async addPending(file: File, dir: string): Promise<string> {
    const id = `pi-${++this.counter}`
    const blobUrl = URL.createObjectURL(file)
    const list = this.pendingByDir.get(dir) || []
    list.push({ id, file, blobUrl, dir })
    this.pendingByDir.set(dir, list)
    try { await savePendingImage({ id, dir, file }) } catch {}
    return blobUrl
  }

  getPending(dir: string): PendingImage[] {
    return this.pendingByDir.get(dir) || []
  }

  hasPending(dir: string): boolean {
    return (this.pendingByDir.get(dir) || []).length > 0
  }

  getAllPendingDirs(): string[] {
    return Array.from(this.pendingByDir.keys())
  }

  getBlobUrl(id: string): string | undefined {
    for (const list of this.pendingByDir.values()) {
      const found = list.find(p => p.id === id)
      if (found) return found.blobUrl
    }
    return undefined
  }

  async commitPending(dir: string, upload: (file: File, dir: string) => Promise<string>): Promise<Map<string, string>> {
    const list = this.pendingByDir.get(dir) || []
    const urlMap = new Map<string, string>()
    for (const p of list) {
      const url = await upload(p.file, dir)
      urlMap.set(p.blobUrl, url)
      URL.revokeObjectURL(p.blobUrl)
      try { await removePendingImageById(p.id) } catch {}
    }
    this.pendingByDir.delete(dir)
    return urlMap
  }

  async removePending(id: string): Promise<boolean> {
    for (const [dir, list] of this.pendingByDir) {
      const idx = list.findIndex(p => p.id === id)
      if (idx !== -1) {
        URL.revokeObjectURL(list[idx].blobUrl)
        list.splice(idx, 1)
        if (list.length === 0) this.pendingByDir.delete(dir)
        try { await removePendingImageById(id) } catch {}
        return true
      }
    }
    return false
  }

  async removeAllForDir(dir: string): Promise<void> {
    const list = this.pendingByDir.get(dir)
    if (list) {
      for (const p of list) {
        URL.revokeObjectURL(p.blobUrl)
        try { await removePendingImageById(p.id) } catch {}
      }
      this.pendingByDir.delete(dir)
    }
  }

  setKnown(dir: string, entries: KnownImage[]): void {
    this.knownByDir.set(dir, entries)
  }

  getKnown(dir: string): KnownImage[] {
    return this.knownByDir.get(dir) || []
  }

  removeKnown(dir: string, name: string): boolean {
    const list = this.knownByDir.get(dir)
    if (!list) return false
    const idx = list.findIndex(k => k.name === name)
    if (idx === -1) return false
    list.splice(idx, 1)
    return true
  }
}

export const imageRegistry = new ImageRegistry()
