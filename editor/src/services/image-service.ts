import { Image } from "@/entities/Image"
import type { ImageEntry } from "@/providers/provider"
import { getProvider } from "@/stores/provider-store"
import { prefsStore } from "@/stores/preferences-store"
import { readFileAsBase64 } from "@/utils/file"

const DB_NAME = "inb4doc-pending-images"
const STORE_NAME = "images"
const DB_VERSION = 1

interface PendingImageRecord {
  id: string
  dir: string
  file: File
}

export interface ImageCommitFailure {
  id: string
  name: string
  error: Error
}

export interface ImageCommitResult {
  urlMap: Map<string, string>
  committedIds: string[]
  failed: ImageCommitFailure[]
}

/**
 * Master switch for orphan-image cleanup. When true (default), an image file
 * is deleted only when the current document dropped its last reference this
 * save. Flip to false to stop deleting images entirely.
 */
export const DELETE_ORPHANED_IMAGES = true

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

class ImageService {
  private pendingByDir = new Map<string, Image[]>()
  private knownByDir = new Map<string, Image[]>()
  private counter = 0
  private currentDocDir = ""

  setCurrentDocDir(dir: string): void {
    this.currentDocDir = dir
  }

  getCurrentDocDir(): string {
    return this.currentDocDir
  }

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

  private isBase64Mode(): boolean {
    return prefsStore.imageStorageMode === "base64"
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

  /**
   * Upload every pending image, independently. A failed upload is collected
   * (record kept, so it can be retried or discarded) and never aborts the
   * whole save — the page still writes, with whatever images succeeded.
   *
   * Records are NOT removed here: they are kept until the doc write that
   * references them succeeds (`confirmCommitted`). If the write fails, the
   * pending→real URL mapping survives for the next save instead of being lost
   * (which would orphan-delete the freshly uploaded file).
   */
  async commitAllPendingImages(): Promise<ImageCommitResult> {
    const provider = getProvider()
    const upload = (file: File, dir: string) => {
      if (provider.uploadImage) return provider.uploadImage(file, dir)
      return readFileAsBase64(file)
    }
    const urlMap = new Map<string, string>()
    const committedIds: string[] = []
    const failed: ImageCommitFailure[] = []
    for (const dir of this.getAllPendingDirs()) {
      const list = this.pendingByDir.get(dir) || []
      for (const img of list) {
        if (!img.file) {
          failed.push({
            id: img.id,
            name: img.id,
            error: new Error("Image file is no longer available"),
          })
          continue
        }
        try {
          const url = await upload(img.file, img.dir)
          urlMap.set(`pending-image:${img.id}`, url)
          committedIds.push(img.id)
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e))
          failed.push({ id: img.id, name: img.id, error })
        }
      }
    }
    return { urlMap, committedIds, failed }
  }

  /** Drop the pending records whose upload AND referencing doc write both
   *  succeeded. Call only after the flush wrote the files using `urlMap`. */
  async confirmCommitted(urlMap: Map<string, string>): Promise<void> {
    for (const key of urlMap.keys()) {
      if (!key.startsWith("pending-image:")) continue
      await this.removePending(key.slice("pending-image:".length))
    }
  }

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

  /** Rename a committed image file on disk. Pending images cannot be renamed
   *  (they are renamed implicitly at upload time). Returns the new URL and
   *  refreshes the known-image cache for `dir`. */
  async renameImage(name: string, newName: string, dir?: string): Promise<string> {
    if (name.startsWith("pi-")) {
      throw new Error("Cannot rename a pending image")
    }
    const provider = getProvider()
    if (!provider.renameImage) {
      throw new Error("Renaming images is not supported in this mode")
    }
    const docDir = dir ?? this.currentDocDir
    const url = await provider.renameImage(name, docDir, newName)
    const list = this.knownByDir.get(docDir)
    if (list) {
      const idx = list.findIndex(k => k.id === name)
      if (idx !== -1) list.splice(idx, 1)
      list.push(Image.fromEntry({ name: newName, url, storageUrl: url, usedIn: [] }, docDir))
    }
    return url
  }

  /**
   * Conservative orphan cleanup, gated by `DELETE_ORPHANED_IMAGES`.
   *
   * Deletes an image from `dir` only when ALL of these hold:
   *   - the current document's pre-edit body (`baselineBody`) referenced it,
   *   - the current document's just-saved body (`newBody`) no longer does,
   *   - the backend reports no references at all (checked against the exact
   *     `docPath` and every other document).
   *
   * Images the current document never referenced are left alone, so unrelated
   * orphaned files in the folder are never touched. The `newBody` check is the
   * authoritative "deleted from the current document" signal — it is immune to
   * backend ref-scan caps/staleness (if the scan misses the current doc, the
   * client-side `newBody` check still keeps the file).
   */
  async cleanupOrphanedImages(opts: {
    dir: string
    docPath: string
    baselineBody: string | undefined
    newBody: string
  }): Promise<void> {
    if (!DELETE_ORPHANED_IMAGES) return
    if (opts.baselineBody === undefined) return
    const provider = getProvider()
    if (!provider.listImages || !provider.deleteImage) return
    try {
      const images = await provider.listImages(opts.dir, true)
      for (const img of images) {
        if (!opts.baselineBody.includes(img.name)) continue
        if (opts.newBody.includes(img.name)) continue
        if (img.usedIn.length > 0) continue
        await provider.deleteImage(img.name, opts.dir)
      }
    } catch {}
  }
}

export const imageService = new ImageService()
