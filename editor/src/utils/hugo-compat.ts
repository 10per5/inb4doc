/**
 * Hugo compatibility layer.
 *
 * Centralizes Hugo-specific conventions so the rest of the codebase
 * doesn't need to know about them:
 *   - `_index` → "Home" (root) / "Index" (nested)
 *   - Only `_index` is allowed as an underscore-prefixed name
 *   - Directory creation auto-generates `_index`
 *
 * To support a different SSG in the future, only this file needs to change.
 */

// ── Constants ──────────────────────────────────────────────────────

/** The filename (with .md) that Hugo treats as the homepage. */
export const HOME_FILENAME = "_index.md"

/** The path slug (without .md) that Hugo treats as the homepage. */
export const HOME_PATH = "_index"

// ── Path checks ────────────────────────────────────────────────────

/** Is this path the root/home page? Accepts "_index" or "index". */
export function isRootPath(path: string): boolean {
  return path === HOME_PATH || path === "index"
}

/** Is this filename the home page file? e.g. "_index.md" */
export function isHomePageFilename(filename: string): boolean {
  return filename === HOME_FILENAME
}

/** Is the last segment of this path a Hugo index file? */
export function isHugoIndex(path: string): boolean {
  const base = path.replace(/\.md$/, "").split("/").pop()
  return base === HOME_PATH
}

// ── Display helpers ────────────────────────────────────────────────

/** Display name for a Hugo index file. "Home" at root, "Index" nested. */
export function hugoIndexDisplayName(path: string): string {
  const stripped = path.replace(/\.md$/, "")
  return stripped === HOME_PATH ? "Home" : "Index"
}

/** Hint text shown when user types "_index" in the create dialog. */
export const HUGO_INDEX_HINT =
  '"_index" is renamed to "Home" in directory view (Hugo Book theme compatibility).'

// ── Page resolution ────────────────────────────────────────────────

/** Strip .md extension from a filename. */
export function stripMdExt(filename: string): string {
  return filename.replace(/\.md$/, "")
}

/**
 * Given a flat list of page paths (without .md, as returned by TreeIndex.paths),
 * resolve the best home page. Prefers `_index`, falls back to the first page.
 * Returns `null` if the list is empty.
 */
export function resolveHomePageFromPaths(paths: string[]): string | null {
  for (const p of paths) {
    if (isRootPath(p)) return p
  }
  return paths.length > 0 ? paths[0] : null
}

// ── Validation ─────────────────────────────────────────────────────

/** Validate a slug for Hugo compatibility. Returns error string or null. */
export function validateHugoSlug(slug: string): string | null {
  if (slug.startsWith("_") && slug !== HOME_PATH) {
    return 'Only "_index" is allowed as a name starting with "_".'
  }
  return null
}
