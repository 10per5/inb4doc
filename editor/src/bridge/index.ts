/**
 * Central registry for all JavaScript APIs exposed to the native Saucer GUI
 * bridge (window.inb4docUI).
 *
 * When adding a new native → JS entry point:
 *   1. Implement the function in its own module under bridge/.
 *   2. Import it here and add it to the inb4docUI object.
 *   3. Call it from C++ via wv.execute("window.inb4docUI?.fnName?.()").
 */
import { showToast } from "@/components/notification/toast"
import { openFind, findNext, findPrev } from "./find"

export { setEditorService } from "./find"

function pipeConsole(): void {
  const methods = ["log", "warn", "error", "debug"] as const
  const orig: Record<string, (...args: unknown[]) => void> = {}
  for (const level of methods) orig[level] = (console as any)[level].bind(console)

  function tryPipe(): void {
    const nativeLog = (window as any).saucer?.exposed?.log
    if (!nativeLog) { setTimeout(tryPipe, 100); return }

    for (const level of methods) {
      ;(console as any)[level] = (...args: unknown[]) => {
        orig[level](...args)
        try {
          nativeLog(`[${level}] ${args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}`)
        } catch {}
      }
    }
  }
  tryPipe()
}

export function initBridge(): void {
  ;(window as any).inb4docUI = {
    showToast,
    openFind,
    findNext,
    findPrev,
  }
  pipeConsole()
}
