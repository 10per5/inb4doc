/**
 * Per-page tracking metadata: the last known server time.
 *
 * Pure data (no behavior), so modeled as an interface rather than a class. Kept
 * separate from the content (`Body` / `Frontmatter`) because it is about sync
 * state, not the page's data.
 */
export interface PageMeta {
  serverTime?: number;
}
