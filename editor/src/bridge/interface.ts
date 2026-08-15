/**
 * The shared JS ⇄ native contract.
 *
 * Every native host implements the same two surfaces:
 *
 *   native → JS : window.inb4docUI — JS APIs the host calls from C++/Java
 *   JS → native : window.saucer.exposed.* — JSON-string envelope methods
 *
 * Desktop Saucer exposes saucer.exposed.* directly; Android exposes
 * NativeBridge.* and the mobile bridge mirrors it onto the same namespace (see
 * bridge/mobile). This module owns the contract plus the mounting helpers both
 * bridges share (host-API registration and console piping). Host-specific
 * wiring lives only in bridge/desktop and bridge/mobile.
 */

import { showToast } from "@/components/notification/toast"
import { openFind, findNext, findPrev } from "./find"

// ── JS → native ──

export interface BridgeEnvelope {
  ok: boolean
  status?: number
  error?: string
  data?: unknown
}

export type BridgeFn = (...args: unknown[]) => Promise<string>

/** Every JS-callable method a native host may expose on saucer.exposed. */
export interface NativeBridgeSurface {
  updaterPut?: BridgeFn
  updaterHas?: BridgeFn
  updaterSizeOf?: BridgeFn
  reload?: BridgeFn
  log?: BridgeFn
  pickDirectory?: BridgeFn
  setContentRoot?: BridgeFn
  getContentRoot?: BridgeFn
  setProvider?: BridgeFn
  getTree?: BridgeFn
  readFile?: BridgeFn
  writeFile?: BridgeFn
  deleteFiles?: BridgeFn
  moveFile?: BridgeFn
  getServerTime?: BridgeFn
  search?: BridgeFn
  uploadImage?: BridgeFn
  listImages?: BridgeFn
  deleteImage?: BridgeFn
  renameImage?: BridgeFn
  resolveImage?: BridgeFn
  copyToClipboard?: BridgeFn
}

/** The Android mirroring list (NativeBridge → saucer.exposed). */
export const NATIVE_BRIDGE_METHODS = [
  "updaterPut",
  "updaterHas",
  "updaterSizeOf",
  "reload",
  "log",
  "pickDirectory",
  "setContentRoot",
  "getContentRoot",
  "setProvider",
  "getTree",
  "readFile",
  "writeFile",
  "deleteFiles",
  "moveFile",
  "getServerTime",
  "search",
  "uploadImage",
  "listImages",
  "deleteImage",
  "renameImage",
  "resolveImage",
] as const satisfies readonly (keyof NativeBridgeSurface)[]

// ── native → JS ──

/** The API every host bridge mounts on window.inb4docUI. */
export interface HostApi {
  showToast: typeof showToast
  openFind: typeof openFind
  findNext: typeof findNext
  findPrev: typeof findPrev
}

const hostApi: HostApi = { showToast, openFind, findNext, findPrev }

/** Mount the shared native → JS API (called by every host bridge). */
export function exposeHostApi(): void {
  ;(window as any).inb4docUI = hostApi
}

/** Pipe console output to the native log on saucer.exposed.log. */
export function pipeConsole(): void {
  const methods = ["log", "warn", "error", "debug"] as const
  const orig: Record<string, (...args: unknown[]) => void> = {}
  for (const level of methods) orig[level] = (console as any)[level].bind(console)

  const format = (args: unknown[]) =>
    args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")

  // Both hosts end up with log on saucer.exposed (Android via the mirror);
  // poll until it arrives, since desktop Saucer injects its API asynchronously.
  function tryPipe(): void {
    const nativeLog = (window as any).saucer?.exposed?.log as BridgeFn | undefined
    if (!nativeLog) { setTimeout(tryPipe, 100); return }

    for (const level of methods) {
      ;(console as any)[level] = (...args: unknown[]) => {
        orig[level](...args)
        try { void nativeLog(`[${level}] ${format(args)}`) } catch {}
      }
    }
  }
  tryPipe()
}
