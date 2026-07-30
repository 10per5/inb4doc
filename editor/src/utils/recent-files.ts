import { recentsStore } from "@/stores/recents-store"

export function addRecent(path: string): void {
  recentsStore.addRecent(path)
}

export function getRecents(): string[] {
  return recentsStore.getRecents()
}

export function clearRecents(): void {
  recentsStore.clearRecents()
}
