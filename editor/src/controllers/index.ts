import { Application } from "@hotwired/stimulus"
import { registerCoreControllers, type ControllerRegistration } from "./core"
import { registerLazyControllers } from "./lazy"

export { registerCoreControllers, registerLazyControllers }
export type { ControllerRegistration } from "./core"

// Single-stage path (non-thin builds): register everything synchronously, as
// before Part D. Thin (FastStartup) builds branch in app.ts instead.
export function registerControllers(app: Application): void {
  registerCoreControllers(app)
  registerLazyControllers(app)
}
