/**
 * Desktop Saucer GUI bridge wiring.
 *
 * Both hosts share the same inb4docUI surface + console piping (bridge/interface);
 * desktop only mounts those — Saucer already exposes its native methods on
 * window.saucer.exposed, so there is nothing to mirror. Host-specific; the pure
 * shared libs live in bridge/index.ts. GuiDesktop only — GuiMobile uses
 * bridge/mobile, web modes neither (see AppFunc.DesktopBridge/MobileBridge).
 */
import { exposeHostApi, pipeConsole } from "../interface"

export function initDesktopBridge(): void {
  exposeHostApi()
  pipeConsole()
}
