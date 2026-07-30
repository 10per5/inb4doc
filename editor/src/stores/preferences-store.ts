import { STORE_PREFS } from "@/config/storage-keys"
import { storageService } from "@/services/storage"
import type { WikiPrefs, ImageStorageMode } from "@/services/storage"

const DEFAULTS: WikiPrefs = {
  stickyToolbar: true,
  imageStorageMode: "file",
  darkMode: false,
  hideEmptyFolders: true,
}

type PrefKey = keyof WikiPrefs

class PreferencesStore {
  private cache = new Map<PrefKey, boolean | string>()

  constructor() {
    storageService.registerInit(STORE_PREFS, (entries) => {
      for (const { id, value } of entries) {
        this.cache.set(id as PrefKey, value as boolean | string)
      }
    })
  }

  private get<T>(key: PrefKey, fallback: T): T {
    const v = this.cache.get(key)
    return v !== undefined ? v as unknown as T : fallback
  }

  private persist(key: PrefKey, value: boolean | string): void {
    this.cache.set(key, value)
    storageService.setJSON(STORE_PREFS, key, value)
  }

  get prefs(): WikiPrefs {
    return {
      stickyToolbar: this.stickyToolbar,
      imageStorageMode: this.imageStorageMode,
      darkMode: this.darkMode,
      hideEmptyFolders: this.hideEmptyFolders,
    }
  }

  get stickyToolbar(): boolean { return this.get("stickyToolbar", DEFAULTS.stickyToolbar) }
  get darkMode(): boolean { return this.get("darkMode", DEFAULTS.darkMode) }
  get imageStorageMode(): ImageStorageMode { return this.get("imageStorageMode", DEFAULTS.imageStorageMode) }
  get hideEmptyFolders(): boolean { return this.get("hideEmptyFolders", DEFAULTS.hideEmptyFolders) }

  setPrefs(partial: Partial<WikiPrefs>): void {
    for (const [key, value] of Object.entries(partial)) {
      this.persist(key as PrefKey, value as boolean | string)
    }
  }

  setStickyToolbar(v: boolean): void { this.persist("stickyToolbar", v) }
  setImageStorageMode(v: ImageStorageMode): void { this.persist("imageStorageMode", v) }
  setDarkMode(v: boolean): void { this.persist("darkMode", v) }
  setHideEmptyFolders(v: boolean): void { this.persist("hideEmptyFolders", v) }
}

export const prefsStore = new PreferencesStore()
