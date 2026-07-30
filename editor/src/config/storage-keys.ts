/**
 * Central registry for all localStorage key patterns used by the app.
 *
 * Key hierarchy (after migration):
 *   inb4doc-prefs            — app preferences
 *   inb4doc-{provider}       — per-provider blob (files + pending + recent)
 *   inb4doc:patch:{p}:{path} — per-file diff (separate to avoid blob rewrite on keystroke)
 *   inb4doc:image:{name}     — base64 image data (separate for size)
 *
 * Legacy patterns (being phased out):
 *   inb4doc:{path}.md         — per-file raw content
 *   inb4doc-storage           — page cache
 *   inb4doc-cache-{key}       — per-provider snapshot
 *   inb4doc-pending-ops[-key] — global pending ops array
 *   inb4doc-connection        — remote server config
 *   inb4doc-last-provider     — last active provider
 *   inb4doc-recent-{type}     — recent files
 */

/** Version stamp for backward-incompatible storage migrations. */
export const VERSION_KEY = "inb4doc-storage-version"

/** Minimum version that is backward-compatible. */
export const MIN_STORAGE_VERSION = [0, 0, 4] as const

/** Preferences key — small, stable, read on every page load. */
export const PREFS_KEY = "inb4doc-prefs"

/** Per-provider blob prefix (append provider type, e.g. "local" → "inb4doc-local"). */
export const PROVIDER_PREFIX = "inb4doc-"



/** Image data key prefix. */
export const IMAGE_PREFIX = "inb4doc:image:"

/** Storage entity type for page/file data. */
export const STORE_FILES = "files"
/** Storage entity type for image metadata. */
export const STORE_IMAGES = "images"
/** Storage entity type for pending operations. */
export const STORE_PENDING_OPS = "pending-ops"
/** Storage entity type for user preferences. */
export const STORE_PREFS = "prefs"
/** Storage entity type for connection config. */
export const STORE_CONNECTIONS = "connections"

/** Per-file patch key prefix. */
export const PATCH_PREFIX = "inb4doc:patch:"

// ── File entry types stored inside per-provider blobs ──

export interface FileEntry {
  content?: string
  body?: string
  baseline?: string
  patch?: string
  serverTime?: number
  frontmatter?: Record<string, unknown>
  originalFrontmatter?: Record<string, unknown>
  dirty?: boolean
}

export interface ProviderData {
  files: Record<string, FileEntry>
  recent: string[]
  connection?: Record<string, unknown>
}

// ── Key helpers ──

/** Build a per-provider blob key from a provider type string. */
export function providerKey(type: string): string {
  return `inb4doc-${type}`
}

/** Build a legacy per-file content key (being phased out). */
export function fileKey(path: string): string {
  return `inb4doc:${path}.md`
}

/** Build a derivable patch key for a specific provider+path. */
export function patchKey(provider: string, path: string): string {
  return `inb4doc:patch:${provider}:${path}`
}

/** Build an image data key from the image name. */
export function imageKey(name: string): string {
  return `inb4doc:image:${name}`
}
