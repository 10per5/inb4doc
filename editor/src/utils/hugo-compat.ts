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

import type { TreeNode } from "@/components/panels/sidebar"

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
 * Given a list of page paths (with .md extensions, as returned by collectPageList),
 * resolve the best home page. Prefers `_index`, falls back to the first page.
 * Returns `null` if the list is empty.
 */
export function resolveHomePage(pagePaths: string[]): string | null {
  for (const p of pagePaths) {
    if (isRootPath(stripMdExt(p))) return stripMdExt(p)
  }
  return pagePaths.length > 0 ? stripMdExt(pagePaths[0]) : null
}

/**
 * Given a flat list of page paths (without .md, as returned by flattenTree/collectPageList),
 * resolve the best home page. Prefers `_index`, falls back to the first page.
 * Returns `null` if the list is empty.
 */
export function resolveHomePageFromPaths(paths: string[]): string | null {
  for (const p of paths) {
    if (isRootPath(p)) return p
  }
  return paths.length > 0 ? paths[0] : null
}

// ── Weight / sort helpers ──────────────────────────────────────────

/**
 * Extract the weight from a folder's _index.md entry for sorting.
 * Returns Infinity if no _index.md or no weight is set.
 */
export function homePageWeight(folderNode: TreeNode): number {
  const indexEntry = (folderNode as Record<string, unknown>)[HOME_FILENAME]
  if (indexEntry != null && typeof indexEntry === "object" && "weight" in indexEntry) {
    return (indexEntry as { weight?: number }).weight ?? Infinity
  }
  return Infinity
}

/**
 * Extract the weight from a node for sidebar sorting.
 * For pages, reads `weight` directly. For folders, reads from `_index.md`.
 * Returns Infinity if no weight is set.
 */
export function nodeWeight(node: unknown): number {
  if (node != null && typeof node === "object" && "weight" in node) {
    return (node as { weight?: number }).weight ?? Infinity
  }
  if (node != null && typeof node === "object") {
    return homePageWeight(node as TreeNode)
  }
  return Infinity
}

// ── Validation ─────────────────────────────────────────────────────

/** Validate a slug for Hugo compatibility. Returns error string or null. */
export function validateHugoSlug(slug: string): string | null {
  if (slug.startsWith("_") && slug !== HOME_PATH) {
    return 'Only "_index" is allowed as a name starting with "_".'
  }
  return null
}
