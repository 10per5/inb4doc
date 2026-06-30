const STORAGE_KEY = "predoc-storage";
const PREFS_KEY = "predoc-prefs";
const PENDING_OPS_KEY = "predoc-pending-ops";

export interface WikiStorage {
  patches: [string, string][];
  lastServerTime?: [string, number][];
  frontmatter?: [string, Record<string, string | number | undefined>][];
  bodies?: [string, string][];
  baselines?: [string, string][];
}

export type ImageStorageMode = "file" | "base64"

export interface WikiPrefs {
  stickyToolbar: boolean;
  imageStorageMode: ImageStorageMode;
}

const DEFAULTS: WikiPrefs = { stickyToolbar: true, imageStorageMode: "file" };

export function loadPrefs(): WikiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function savePrefs(prefs: WikiPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function loadStorage(): WikiStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        patches: data.patches || [],
        lastServerTime: data.lastServerTime || [],
        frontmatter: data.frontmatter || [],
        bodies: data.bodies || [],
        baselines: data.baselines || [],
      };
    }
  } catch {}
  return { patches: [] };
}

export function saveStorage(storage: WikiStorage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

export function savePendingOps(ops: unknown[]): void {
  try { localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops)) } catch {}
}

export function loadPendingOps<T = unknown[]>(): T {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return [] as unknown as T
}

export function clearPendingOpsStorage(): void {
  localStorage.removeItem(PENDING_OPS_KEY)
}

/** Clear all cached storage data from localStorage. Useful when switching to/from localStorage provider. */
export function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}
