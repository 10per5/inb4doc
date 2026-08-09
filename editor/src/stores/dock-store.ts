export type DockItem = "navigation" | "editor" | "more"

export class DockStore {
  private active: DockItem = "editor"
  private listeners = new Set<(item: DockItem) => void>()

  getActive(): DockItem {
    return this.active
  }

  setActive(item: DockItem): void {
    if (this.active === item) return
    this.active = item
    this.listeners.forEach((listener) => listener(item))
  }

  subscribe(listener: (item: DockItem) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const dockStore = new DockStore()
