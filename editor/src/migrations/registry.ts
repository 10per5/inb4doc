import type { Migration } from "./types"

export class MigrationRegistry {
  private migrations: Migration[] = []

  add(m: Migration): void {
    if (this.migrations.some((x) => x.from === m.from)) {
      throw new Error(`Migration from ${m.from} already registered`)
    }
    this.migrations.push(m)
  }

  /** Return ordered path from stored version → current version, or empty if none needed. */
  getPath(stored: string, current: string): Migration[] {
    const path: Migration[] = []
    let v = stored
    while (v !== current) {
      const next = this.migrations.find((m) => m.from === v)
      if (!next) break
      path.push(next)
      v = next.to
    }
    return path
  }
}

export const registry = new MigrationRegistry()
