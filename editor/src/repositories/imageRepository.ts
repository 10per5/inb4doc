import { Image } from "@/entities/Image"
import type { ImageEntry } from "@/providers/provider"
import { getProvider } from "@/stores/provider-store"
import { loadPrefs } from "@/utils/storage"
import { readFileAsBase64 } from "@/utils/file"

const DB_NAME = "inb4doc-pending-images"
const STORE_NAME = "images"
const DB_VERSION = 1

interface PendingImageRecord {
  id: string
  dir: string
  file: File
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveRecord(record: PendingImageRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadAllRecords(): Promise<PendingImageRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function removeRecordById(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

class ImageRepository {
  private pendingByDir = new Map<string, Image[]>()
  private knownByDir = new Map<string, Image[]>()
  private counter = 0
  private currentDocDir = ""

  // ── Current directory ──

  setCurrentDocDir(dir: string): void {
    this.currentDocDir = dir
  }

  getCurrentDocDir(): string {
    return this.currentDocDir
  }

  // ── Storage restore ──

  async restoreFromStorage(): Promise<void> {
    const records = await loadAllRecords()
    for (const r of records) {
      const img = Image.fromRecord(r)
      const list = this.pendingByDir.get(r.dir) || []
      list.push(img)
      this.pendingByDir.set(r.dir, list)
      if (r.id.startsWith("pi-")) {
        const num = parseInt(r.id.slice(3), 10)
        if (num > this.counter) this.counter = num
      }
    }
  }

  // ── Upload / commit ──

  private isBase64Mode(): boolean {
    return loadPrefs().imageStorageMode === "base64"
  }

  async uploadImage(file: File): Promise<string> {
    if (this.isBase64Mode()) {
      return readFileAsBase64(file)
    }
    const provider = getProvider()
    if (provider.uploadImage) {
      return this.addPending(file, this.currentDocDir)
    }
    return readFileAsBase64(file)
  }

  async addPending(file: File, dir: string): Promise<string> {
    const id = `pi-${++this.counter}`
    const img = new Image(id, dir, file)
    img.blobUrl = URL.createObjectURL(file)
    const list = this.pendingByDir.get(dir) || []
    list.push(img)
    this.pendingByDir.set(dir, list)
    try { await saveRecord({ id, dir, file }) } catch {}
    return `pending-image:${id}`
  }

  async commitPendingImages(dir: string): Promise<Map<string, string>> {
    if (!this.hasPending(dir)) return new Map()
    const provider = getProvider()
    const upload = async (file: File, d: string) => {
      if (provider.uploadImage) {
        return provider.uploadImage(file, d)
      }
      return readFileAsBase64(file)
    }
    return this.commitPending(dir, upload)
  }

  async commitAllPendingImages(): Promise<Map<string, string>> {
    const combined = new Map<string, string>()
    const dirs = this.getAllPendingDirs()
    for (const dir of dirs) {
      const map = await this.commitPendingImages(dir)
      for (const [k, v] of map) {
        combined.set(k, v)
      }
    }
    return combined
  }

  async commitPending(dir: string, upload: (file: File, dir: string) => Promise<string>): Promise<Map<string, string>> {
    const list = this.pendingByDir.get(dir) || []
    const urlMap = new Map<string, string>()
    for (const img of list) {
      const url = await upload(img.file!, dir)
      urlMap.set(`pending-image:${img.id}`, url)
      img.commit(url)
      try { await removeRecordById(img.id) } catch {}
    }
    this.pendingByDir.delete(dir)
    return urlMap
  }

  // ── Pending queries ──

  getPending(dir: string): Image[] {
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

  // ── Remove pending ──

  async removePending(id: string): Promise<boolean> {
    for (const [dir, list] of this.pendingByDir) {
      const idx = list.findIndex(p => p.id === id)
      if (idx !== -1) {
        list[idx].revokeBlobUrl()
        list.splice(idx, 1)
        if (list.length === 0) this.pendingByDir.delete(dir)
        try { await removeRecordById(id) } catch {}
        return true
      }
    }
    return false
  }

  async removeAllForDir(dir: string): Promise<void> {
    const list = this.pendingByDir.get(dir)
    if (list) {
      for (const img of list) {
        img.revokeBlobUrl()
        try { await removeRecordById(img.id) } catch {}
      }
      this.pendingByDir.delete(dir)
    }
  }

  async remapDir(oldDir: string, newDir: string): Promise<void> {
    const list = this.pendingByDir.get(oldDir)
    if (!list || list.length === 0) return
    for (const img of list) {
      img.dir = newDir
      try {
        await removeRecordById(img.id)
        await saveRecord({ id: img.id, dir: newDir, file: img.file! })
      } catch {}
    }
    this.pendingByDir.set(newDir, list)
    this.pendingByDir.delete(oldDir)
  }

  // ── Known (committed) images ──

  setKnown(dir: string, entries: ImageEntry[]): void {
    this.knownByDir.set(dir, entries.map(e => Image.fromEntry(e, dir)))
  }

  getKnown(dir: string): Image[] {
    return this.knownByDir.get(dir) || []
  }

  removeKnown(dir: string, name: string): boolean {
    const list = this.knownByDir.get(dir)
    if (!list) return false
    const idx = list.findIndex(k => k.id === name)
    if (idx === -1) return false
    list.splice(idx, 1)
    return true
  }

  // ── Provider-backed operations ──

  async listImages(refs?: boolean): Promise<ImageEntry[]> {
    const provider = getProvider()
    if (provider.listImages) {
      const known = await provider.listImages(this.currentDocDir, refs)
      this.setKnown(this.currentDocDir, known)
      return known
    }
    return []
  }

  getAllImages(): (ImageEntry & { pending?: boolean })[] {
    const known = this.getKnown(this.currentDocDir).map(img => ({
      name: img.name,
      url: img.url!,
      storageUrl: img.storageUrl!,
      usedIn: img.usedIn,
    }))
    const pending = this.getPending(this.currentDocDir).map(p => ({
      name: p.id,
      url: p.blobUrl!,
      storageUrl: p.blobUrl!,
      usedIn: [] as string[],
      pending: true as const,
    }))
    return [...known, ...pending]
  }

  async deleteImage(name: string): Promise<void> {
    if (name.startsWith("pi-")) {
      await this.removePending(name)
      return
    }
    const provider = getProvider()
    if (provider.deleteImage) {
      return provider.deleteImage(name, this.currentDocDir)
    }
  }
}

export const imageRepository = new ImageRepository()
