/**
 * project-entry — which document a project opens on.
 *
 * Switching projects used to leave whatever document was open (often from the
 * previous project) in place. This resolves the swap target instead:
 *
 * 1. the document last opened **inside that project** (recents are per content
 *    root, so filtering them by scope gives "where you were here"),
 * 2. otherwise the first page that actually has content — `_index` files that
 *    only carry a title (`# thisthat`) are skipped, so a stub home page no
 *    longer swallows the switch,
 * 3. otherwise the first page there is.
 */

import { prefsStore } from "@/stores/preferences-store"
import { recentsStore } from "@/stores/recents-store"
import { pagesStore } from "@/stores/page-store"
import { treeStore } from "@/stores/tree-store"
import { getProvider } from "@/stores/provider-store"
import { stripFrontmatter } from "@/utils/frontmatter"
import { HOME_PATH, isRootPath } from "@/utils/hugo-compat"
import { flattenTreeOrder } from "@/utils/tree"
import type { PendingOps } from "@/entities/PendingOps"

/** How many candidate pages are read from disk while looking for real content. */
const CONTENT_LOOKAHEAD = 12

/** Is `path` inside `scope`? "" means the whole content root. */
export function isPathInScope(path: string, scope: string): boolean {
  if (!scope) return true
  return path === scope || path.startsWith(`${scope}/`)
}

/**
 * Page paths inside `scope`, in explorer order (a folder's `_index` ahead of
 * its children — the same order the sidebar and the file jumper use).
 */
export function scopedPagePaths(scope: string, ops?: PendingOps): string[] {
  const tree = ops ? ops.applyToTree(treeStore.getTree()) : treeStore.getTree()
  return flattenTreeOrder(tree).filter(
    (p) => tree.paths.has(p) && isPathInScope(p, scope),
  )
}

/**
 * True when the file has anything besides frontmatter and leading headings —
 * i.e. it is a real page and not just a `# Title` stub.
 */
export function hasContentBeyondTitle(raw: string | null | undefined): boolean {
  if (!raw) return false
  const { body } = stripFrontmatter(raw)
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    // Leading ATX headings are the title block; everything past it is content.
    if (/^#{1,6}\s/.test(trimmed)) continue
    return true
  }
  return false
}

/** Reads the current content of a page (page cache first, provider otherwise). */
async function readPageContent(path: string): Promise<string | null> {
  // Page bodies are body-only (frontmatter lives separately), but the check
  // only cares whether anything is there, which body-only answers just as well.
  const body = pagesStore.get(path)?.bodyState?.body;
  if (body !== undefined) return body;
  try {
    // Providers append `.md` themselves — pass the tree path as-is.
    return await getProvider().readFile(path);
  } catch {
    return null;
  }
}

/**
 * The document to open after switching into a project. Returns null when the
 * scope has no pages at all (the sidebar shows the empty state instead).
 */
export async function resolveProjectEntryPath(
  scope: string,
  ops?: PendingOps,
): Promise<string | null> {
  const pages = scopedPagePaths(scope, ops)
  if (pages.length === 0) return null

  const recent = recentsStore.getRecents().find((p) => pages.includes(p))
  if (recent) return recent

  // The project's own `_index` wins when it has content; otherwise walk the
  // explorer order and take the first page that isn't a title-only stub.
  const home = pages.find((p) => isRootPath(p) || p.endsWith(`/${HOME_PATH}`))
  const candidates = home ? [home, ...pages.filter((p) => p !== home)] : pages

  for (const path of candidates.slice(0, CONTENT_LOOKAHEAD)) {
    if (hasContentBeyondTitle(await readPageContent(path))) return path
  }
  return candidates[0] ?? null
}

/** Current project scope — the pref that switching projects writes. */
export function currentProjectScope(): string {
  return prefsStore.rootScope
}
