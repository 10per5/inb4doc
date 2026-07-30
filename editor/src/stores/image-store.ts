import { STORE_IMAGES } from "@/config/storage-keys"
import { EntityStore } from "@/stores/entity-store"

export interface ImageEntry {
  name: string
  data: string
}

class ImageStore extends EntityStore<ImageEntry> {
  constructor() {
    super(STORE_IMAGES, { autoFlush: true })
  }

  getImage(name: string): string | null {
    const cached = this.getFromCache(name)
    if (cached) return cached.data
    return this.storage.getImage(name)
  }

  setImage(name: string, data: string): void {
    this.cache.set(name, { name, data })
    this.persistDebounced(name, { name, data })
  }

  deleteImage(name: string): void {
    this.storage.deleteImage(name)
    this.removeFromStore(name)
  }

  listImageNames(): string[] {
    return this.storage.listImageNames()
  }
}

export const imageStore = new ImageStore()
