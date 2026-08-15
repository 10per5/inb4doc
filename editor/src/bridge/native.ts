/**
 * Shared native-bridge envelope + project-directory helpers.
 *
 * The native host (desktop Saucer `window.saucer.exposed.*`, Android WebView
 * `window.NativeBridge.*` forwarded onto the same namespace) exposes JSON
 * string methods with the shape `{ok, status?, error?, data?}`. Everything in
 * this module is host-agnostic so the providers and the bridge wiring can
 * reuse it.
 */

import { backendError } from "@/utils/backend-error"
import { BridgeOp, bridgeOpName } from "@/config/enums/bridge-op"

export interface BridgeEnvelope {
  ok: boolean
  status?: number
  error?: string
  data?: unknown
}

export type BridgeFn = (...args: unknown[]) => Promise<string>

export async function callBridge(op: BridgeOp, ...args: unknown[]): Promise<BridgeEnvelope> {
  const fn = bridgeOpName(op)
  const exposed = (window as any).saucer?.exposed as Record<string, BridgeFn> | undefined
  const caller = exposed?.[fn]
  if (typeof caller !== "function") {
    throw backendError(500, `Native bridge function "${fn}" is unavailable`)
  }
  let raw: string
  try {
    raw = await caller(...args)
  } catch (e) {
    throw backendError(500, `Native bridge "${fn}" failed: ${String(e)}`)
  }
  let env: BridgeEnvelope
  try {
    env = JSON.parse(raw)
  } catch {
    throw backendError(500, `Native bridge "${fn}" returned invalid data`)
  }
  if (!env.ok) {
    throw backendError(env.status ?? 500, env.error ?? `Native bridge "${fn}" failed`)
  }
  return env
}

export interface ProjectRootInfo {
  path: string
  name: string
}

/**
 * Ask the native host to show a folder picker (desktop: native dialog;
 * Android: SAF OpenDocumentTree). Resolves null when the user cancels.
 */
export async function pickProjectDirectory(): Promise<ProjectRootInfo | null> {
  const env = await callBridge(BridgeOp.PickDirectory)
  const data = env.data as { path?: string | null; name?: string } | undefined
  if (!data?.path) return null
  return { path: data.path, name: data.name ?? data.path }
}

/** Switch the native host's content root (validated host-side). */
export async function setContentRoot(path: string): Promise<void> {
  await callBridge(BridgeOp.SetContentRoot, path)
}

/** Current native content root (used by mobile to restore the last project). */
export async function getContentRoot(): Promise<ProjectRootInfo | null> {
  const env = await callBridge(BridgeOp.GetContentRoot)
  const data = env.data as { path?: string | null; name?: string } | undefined
  if (!data?.path) return null
  return { path: data.path, name: data.name ?? data.path }
}
