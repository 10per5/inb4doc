import { STORE_PREFS } from "@/config/storage-keys";
import { storageService } from "@/services/storage-service";
import type { WikiPrefs, ImageStorageMode } from "@/services/storage-service";

const DEFAULTS: WikiPrefs = {
  stickyToolbar: true,
  imageStorageMode: "file",
  darkMode: false,
  hideEmptyFolders: true,
  rootScope: "",
  pinnedProjects: [],
  spellcheck: false,
  spellcheckLanguages: ["en"],
  followCaretToolbar: true,
  customCss: "",
};

type PrefKey = keyof WikiPrefs;
type PrefValue = WikiPrefs[PrefKey];

class PreferencesStore {
  private cache = new Map<PrefKey, PrefValue>();

  constructor() {
    storageService.registerInit(STORE_PREFS, (entries) => {
      for (const { id, value } of entries) {
        this.cache.set(id as PrefKey, this.normalize(id as PrefKey, value));
      }
    });
  }

  // Stored prefs come back from localStorage as plain JSON; arrays round-trip
  // as arrays but a corrupt/hand-edited entry can be anything, so every read
  // goes back through the default for its type.
  private normalize(key: PrefKey, value: unknown): PrefValue {
    if (value === undefined || value === null) return DEFAULTS[key];
    if (Array.isArray(DEFAULTS[key])) {
      return Array.isArray(value) ? (value as string[]) : DEFAULTS[key];
    }
    return value as PrefValue;
  }

  private get<T>(key: PrefKey): T {
    const v = this.cache.get(key);
    return (v !== undefined ? v : DEFAULTS[key]) as T;
  }

  private persist(key: PrefKey, value: PrefValue): void {
    this.cache.set(key, value);
    storageService.setJSON(STORE_PREFS, key, value);
  }

  get prefs(): WikiPrefs {
    return {
      stickyToolbar: this.stickyToolbar,
      imageStorageMode: this.imageStorageMode,
      darkMode: this.darkMode,
      hideEmptyFolders: this.hideEmptyFolders,
      rootScope: this.rootScope,
      pinnedProjects: this.pinnedProjects,
      spellcheck: this.spellcheck,
      spellcheckLanguages: this.spellcheckLanguages,
      followCaretToolbar: this.followCaretToolbar,
      customCss: this.customCss,
    };
  }

  get stickyToolbar(): boolean {
    return this.get("stickyToolbar");
  }
  get darkMode(): boolean {
    return this.get("darkMode");
  }
  get imageStorageMode(): ImageStorageMode {
    return this.get("imageStorageMode");
  }
  get hideEmptyFolders(): boolean {
    return this.get("hideEmptyFolders");
  }
  get rootScope(): string {
    return this.get("rootScope");
  }
  get pinnedProjects(): string[] {
    return this.get("pinnedProjects");
  }
  get spellcheck(): boolean {
    return this.get("spellcheck");
  }
  get spellcheckLanguages(): string[] {
    return this.get("spellcheckLanguages");
  }
  get followCaretToolbar(): boolean {
    return this.get("followCaretToolbar");
  }
  get customCss(): string {
    return this.get("customCss");
  }

  setPrefs(partial: Partial<WikiPrefs>): void {
    for (const [key, value] of Object.entries(partial)) {
      this.persist(key as PrefKey, value as PrefValue);
    }
  }

  setStickyToolbar(v: boolean): void {
    this.persist("stickyToolbar", v);
  }
  setImageStorageMode(v: ImageStorageMode): void {
    this.persist("imageStorageMode", v);
  }
  setDarkMode(v: boolean): void {
    this.persist("darkMode", v);
  }
  setHideEmptyFolders(v: boolean): void {
    this.persist("hideEmptyFolders", v);
  }
  setRootScope(v: string): void {
    this.persist("rootScope", v);
  }
  setPinnedProjects(v: string[]): void {
    this.persist("pinnedProjects", v);
  }
  setSpellcheck(v: boolean): void {
    this.persist("spellcheck", v);
  }
  setSpellcheckLanguages(v: string[]): void {
    this.persist("spellcheckLanguages", v);
  }
  setFollowCaretToolbar(v: boolean): void {
    this.persist("followCaretToolbar", v);
  }
  setCustomCss(v: string): void {
    this.persist("customCss", v);
  }
}

export const prefsStore = new PreferencesStore();
