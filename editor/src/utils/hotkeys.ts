/**
 * Hotkeys — lightweight keyboard shortcut registration.
 *
 * Flattened from HotkeyManager class. Import and call attach() once at init.
 */

type HotkeyHandler = (e: KeyboardEvent) => void

const SHIFT = 1
const CTRL = 2
const META = 4

interface Binding {
  mods: number
  key: string
  handler: HotkeyHandler
}

const bindings: Binding[] = []

export function register(key: string, handler: HotkeyHandler): void {
  const parts = key.split("+").map((s) => s.trim().toLowerCase())
  let mods = 0
  let targetKey = ""
  for (const p of parts) {
    if (p === "ctrl") mods |= CTRL
    else if (p === "shift") mods |= SHIFT
    else if (p === "meta" || p === "cmd") mods |= META
    else targetKey = p
  }
  if (!targetKey) return
  bindings.push({ mods, key: targetKey, handler })
}

export function handle(e: KeyboardEvent): boolean {
  let mods = 0
  if (e.ctrlKey) mods |= CTRL
  if (e.shiftKey) mods |= SHIFT
  if (e.metaKey) mods |= META

  const key = e.key.toLowerCase()
  for (const b of bindings) {
    if (b.mods === mods && b.key === key) {
      e.preventDefault()
      b.handler(e)
      return true
    }
  }
  return false
}

let attached = false

export function attach(): void {
  if (attached) return
  attached = true
  document.addEventListener("keydown", handle)
}

export function detach(): void {
  if (!attached) return
  attached = false
  document.removeEventListener("keydown", handle)
}
