/**
 * Per-provider recently-opened files tracking.
 *
 * Stored in localStorage under `inb4doc-recent-{providerType}`.
 * Capped at 5 entries; deduped on insert.
 */

import { cacheKeyForProvider, getProvider } from "@/stores/provider-store"

const MAX_RECENTS = 5
const PREFIX = "inb4doc-recent-"

function key(): string {
  return PREFIX + cacheKeyForProvider(getProvider().name)
}

export function addRecent(path: string): void {
  const list = getRecents()
  const next = [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENTS)
  try { localStorage.setItem(key(), JSON.stringify(next)) } catch {}
}

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(key())
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export function clearRecents(): void {
  try { localStorage.removeItem(key()) } catch {}
}
