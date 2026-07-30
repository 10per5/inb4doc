import { Page, type PageData } from "@/entities/Page"
import { storageService } from "@/services/storage"
import { appEvents, AppEvent } from "@/stores/app-events"
import { STORE_FILES } from "@/config/storage-keys"
import { activeProviderId } from "@/stores/provider-store"

class PagesStore {
  private cache = new Map<string, Page>()

  constructor() {
    storageService.registerInit(STORE_FILES, (entries) => {
      const prefix = activeProviderId() + "/"
      for (const { id, value } of entries) {
        if (!id.startsWith(prefix)) continue
        const path = id.slice(prefix.length)
        this.cache.set(path, Page.decode(path, value as PageData))
      }
    })
    appEvents.on(AppEvent.ProviderFilesLoaded, (files) => {
      this.cache.clear()
      const prefix = activeProviderId() + "/"
      const loaded = new Set(Object.keys(files))
      for (const id of storageService.getMetaIds(STORE_FILES)) {
        if (!id.startsWith(prefix)) continue
        const path = id.slice(prefix.length)
        if (!loaded.has(path)) {
          storageService.removeEntity(STORE_FILES, id)
        }
      }
      for (const [path, entry] of Object.entries(files)) {
        this.cache.set(path, Page.decode(path, entry as PageData))
      }
    })
  }

  get(path: string): Page | undefined {
    return this.cache.get(path)
  }

  getOrCreate(path: string): Page {
    let page = this.cache.get(path)
    if (!page) {
      page = new Page(path)
      this.cache.set(path, page)
    }
    return page
  }

  clearPath(path: string): void {
    this.cache.delete(path)
  }

  clearAll(): void {
    this.cache.clear()
  }
}

export const pagesStore = new PagesStore()
