import type { ModuleRegistry } from "./module-registry-service"

let _registry: ModuleRegistry | null = null

export function setRegistry(r: ModuleRegistry): void {
  _registry = r
}

export function getRegistry(): ModuleRegistry {
  if (!_registry) throw new Error("ModuleRegistry not initialized")
  return _registry
}
