import type { Migration } from "../types"

export const v0_0_4_to_v0_0_4p1: Migration = {
  from: "0.0.4",
  to: "0.0.4p1",
  description: "Placeholder — no data changes yet",
  migrate: async () => {
    return { success: true }
  },
}
