let cachedModuleSystem: any = null

export function getFarmModuleSystem(): any {
  if (cachedModuleSystem) return cachedModuleSystem

  const getMs = (obj: any) => {
    if (!obj || !obj.__farm_module_system__) return null
    return typeof obj.__farm_module_system__ === "function"
      ? obj.__farm_module_system__()
      : obj.__farm_module_system__
  }

  const direct = getMs(window)
  if (direct) {
    cachedModuleSystem = direct
    return direct
  }

  const keys = Array.from(new Set([...Object.keys(window), ...Object.getOwnPropertyNames(window)]))
  for (const key of keys) {
    try {
      const val = (window as Record<string, any>)[key]
      const ms = getMs(val)
      if (ms) {
        cachedModuleSystem = ms
        return ms
      }
    } catch (_) {
      // Ignore errors when inspecting restricted window properties
    }
  }
  return null
}

export function initFarmCompat(publicPath: string): void {
  const ms = getFarmModuleSystem()
  if (ms && typeof ms.setPublicPaths === "function") {
    ms.setPublicPaths([publicPath])
  }
}