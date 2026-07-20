import type { Frontmatter } from "@/entities/Frontmatter";
import type { MetaPanelData } from "@/components/panels/meta-panel";

export type MetaDiffStatus = "added" | "removed" | "changed";

export interface MetaDiffEntry {
  key: string;
  oldVal?: string | number;
  newVal?: string | number;
  status: MetaDiffStatus;
}

/**
 * Diff two frontmatter snapshots. `orig` is the baseline (pre-edit) frontmatter
 * and `curr` the current one. Returns one entry per key whose value changed,
 * including keys added or removed between the two.
 *
 * Either argument may be undefined (e.g. no frontmatter in the baseline).
 */
export function diffFrontmatter(
  orig?: Frontmatter,
  curr?: Frontmatter,
): MetaDiffEntry[] {
  const origData: MetaPanelData = orig?.toMeta() ?? ({} as MetaPanelData);
  const currData: MetaPanelData = curr?.toMeta() ?? ({} as MetaPanelData);

  const keys = new Set([
    ...Object.keys(origData),
    ...Object.keys(currData),
  ]);

  const entries: MetaDiffEntry[] = [];
  for (const key of keys) {
    const oldVal = origData[key];
    const newVal = currData[key];

    if (oldVal === undefined && newVal !== undefined) {
      entries.push({ key, newVal, status: "added" });
    } else if (oldVal !== undefined && newVal === undefined) {
      entries.push({ key, oldVal, status: "removed" });
    } else if (String(oldVal) !== String(newVal)) {
      entries.push({ key, oldVal, newVal, status: "changed" });
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
