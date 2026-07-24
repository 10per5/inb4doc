const PREFS_KEY = "inb4doc-prefs";
const PENDING_OPS_KEY = "inb4doc-pending-ops";

export type ImageStorageMode = "file" | "base64"

export interface WikiPrefs {
  stickyToolbar: boolean;
  imageStorageMode: ImageStorageMode;
  darkMode: boolean;
}

const DEFAULTS: WikiPrefs = { stickyToolbar: true, imageStorageMode: "file", darkMode: false };

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function loadPrefs(): WikiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS, darkMode: systemPrefersDark() };
}

export function savePrefs(prefs: WikiPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function savePendingOps(ops: readonly unknown[], providerKey?: string): void {
  const key = providerKey ? `${PENDING_OPS_KEY}-${providerKey}` : PENDING_OPS_KEY
  try { localStorage.setItem(key, JSON.stringify(ops)) } catch {}
}

export function loadPendingOps<T = unknown[]>(providerKey?: string): T {
  const key = providerKey ? `${PENDING_OPS_KEY}-${providerKey}` : PENDING_OPS_KEY
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {}
  return [] as unknown as T
}

export function clearPendingOpsStorage(providerKey?: string): void {
  const key = providerKey ? `${PENDING_OPS_KEY}-${providerKey}` : PENDING_OPS_KEY
  localStorage.removeItem(key)
}
