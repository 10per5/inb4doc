/**
 * JS → native transport + typed bridge-op helpers.
 *
 * The native host (desktop Saucer `window.saucer.exposed.*`, Android WebView
 * `window.NativeBridge.*` forwarded onto the same namespace) exposes JSON
 * string methods with the envelope shape `{ok, status?, error?, data?}` (see
 * bridge/interface). This module is the host-agnostic caller side the
 * providers use; the per-host wiring lives in bridge/desktop and bridge/mobile.
 */

import { backendError } from "@/utils/backend-error"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { BridgeOp, bridgeOpName } from "@/config/enums/bridge-op"
import type { BridgeEnvelope, BridgeFn, NativeBridgeSurface } from "./interface"

export async function callBridge(op: BridgeOp, ...args: unknown[]): Promise<BridgeEnvelope> {
  const fn = bridgeOpName(op)
  const exposed = (window as any).saucer?.exposed as NativeBridgeSurface | undefined
  const caller = exposed?.[fn as keyof NativeBridgeSurface]
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

/**
 * Tell the native host which provider is active so its FS ops root at the
 * right tree. Mobile-only: Android WebView needs this (Saf → built-in docs,
 * Fs → picked tree); the desktop host has no such op. No-op in every other
 * build mode.
 */
export async function setNativeProvider(type: number): Promise<void> {
  if (!hasFunc(AppFunc.SafProvider)) return
  await callBridge(BridgeOp.SetProvider, type)
}
