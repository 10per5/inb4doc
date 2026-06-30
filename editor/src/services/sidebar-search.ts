import { getProvider } from "../content/provider-registry";
import type { TreeNode } from "../components/panels/sidebar";
import { searchCache, type SearchMatch } from "./cache-management-service";
import { hotkeys } from "./hotkey-manager";

export type { SearchMatch } from "./cache-management-service";

export function focusSidebarSearch(): void {
  const input = document.querySelector<HTMLInputElement>(".sidebar-search");
  input?.focus();
  input?.select();
}

// Register global hotkey
hotkeys.register("ctrl+shift+f", focusSidebarSearch);

export function collectPagePaths(node: TreeNode): string[] {
  const paths: string[] = [];
  function walk(n: TreeNode, prefix: string) {
    for (const [name, val] of Object.entries(n)) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (val === null || (typeof val === "object" && "weight" in val)) {
        paths.push(full.replace(/\.md$/, ""));
      } else if (typeof val === "object") {
        walk(val as TreeNode, full);
      }
    }
  }
  walk(node, "");
  return paths;
}

export async function searchContent(
  allPaths: string[],
  query: string,
): Promise<SearchMatch[]> {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: SearchMatch[] = [];
  const searched = new Set<string>();

  // Phase 1: cache (sync) — already-loaded files
  for (const match of searchCache(allPaths, q)) {
    searched.add(match.path);
    results.push(match);
  }

  // Phase 2: provider (async) — all files via dedicated search endpoint
  const provider = getProvider();
  if (provider.search) {
    const serverResults = await provider.search(query);
    for (const r of serverResults) {
      if (allPaths.includes(r.path) && !searched.has(r.path)) {
        results.push(r);
      }
    }
  }

  return results;
}
