import { registry } from "./registry"
import { v0_0_4_to_v0_0_4p1 } from "./v0.0.4_to_v0.0.4p1"

registry.add(v0_0_4_to_v0_0_4p1)

export { runMigrations } from "./runner"
export { registry } from "./registry"
export type { Migration, MigrationContext, MigrationResult } from "./types"
