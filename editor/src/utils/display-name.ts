/**
 * Single source of truth for a page's display name.
 *
 * Uses Hugo compat rules for _index files. The derivation:
 *   - frontmatter `title` wins when provided
 *   - `_index` is "Home" at the root and "Index" when nested
 *   - every other file derives its label from its name
 */
import { isHugoIndex, hugoIndexDisplayName } from "@/utils/hugo-compat"

export function pageDisplayName(
  path: string,
  frontmatterTitle?: string,
): string {
  if (frontmatterTitle && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }

  const stripped = path.replace(/\.md$/, "");
  const base = stripped.split("/").pop() || stripped;

  if (isHugoIndex(path)) {
    return hugoIndexDisplayName(path);
  }

  return base.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
