/**
 * Desktop Saucer GUI bridge wiring.
 *
 * Registers the native → JS API on window.inb4docUI (called from C++ via
 * wv.execute("window.inb4docUI?.fnName?.()")) and pipes console output to the
 * native host. Host-specific; the pure shared libs live in bridge/index.ts.
 * GuiDesktop only — GuiMobile uses bridge/mobile, web modes neither (see
 * AppFunc.DesktopBridge/MobileBridge).
 */
import { showToast, openFind, findNext, findPrev } from "../index"

function pipeConsole(): void {
  const methods = ["log", "warn", "error", "debug"] as const
  const orig: Record<string, (...args: unknown[]) => void> = {}
  for (const level of methods) orig[level] = (console as any)[level].bind(console)

  const format = (args: unknown[]) =>
    args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")

  // Desktop Saucer: poll until the bridge is injected
  function tryPipe(): void {
    const nativeLog = (window as any).saucer?.exposed?.log
    if (!nativeLog) { setTimeout(tryPipe, 100); return }

    for (const level of methods) {
      ;(console as any)[level] = (...args: unknown[]) => {
        orig[level](...args)
        try { nativeLog(`[${level}] ${format(args)}`) } catch {}
      }
    }
  }
  tryPipe()
}

export function initDesktopBridge(): void {
  ;(window as any).inb4docUI = {
    showToast,
    openFind,
    findNext,
    findPrev,
  }
  pipeConsole()
}
