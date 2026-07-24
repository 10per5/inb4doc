import { getProvider } from "@/stores/provider-store";
import { searchCache, type SearchMatch } from "@/controllers/file-sync-controller";
import { register as registerHotkey } from "@/utils/hotkeys";

export type { SearchMatch } from "@/controllers/file-sync-controller";

export function focusSidebarSearch(): void {
  const input = document.querySelector<HTMLInputElement>(".sidebar-search");
  input?.focus();
  input?.select();
}

// Register global hotkey
registerHotkey("ctrl+shift+f", focusSidebarSearch);

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
