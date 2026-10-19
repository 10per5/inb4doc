/**
 * WindowService — the app's mini-window manager.
 *
 * Preferences, About, the storage-backend picker and the image manager are all
 * **windows**, not dialogs: floating secondary surfaces sharing one chrome
 * (header + body + action row, styled by `.window-box`). Everything about them
 * is owned here — mounting, z-order, dismissal and, most importantly, the
 * **stack**, so a window opened from another window knows where it came from:
 *
 * ```
 * openWindow("prefs")                 → stack: [prefs]
 *   click Change… in the Storage pane → openWindow("provider-dialog")
 *                                       stack: [prefs, provider]  (prefs hidden)
 *   Cancel / Accept                   → provider closes, prefs is revealed again
 * ```
 *
 * A window opened on its own has no parent, so closing it simply empties the
 * stack and removes the overlay — no call-site special cases.
 *
 * Each window keeps its own Stimulus body controller: the manager renders the
 * frame, mounts `<div data-controller="<id>" data-<id>-payload-value="…">`
 * inside it, and resolves the caller's promise when the body dispatches
 * `dialog:confirm` / `dialog:cancel` (BaseDialogController) or when a listener
 * passed by the facade calls `handle.close(value)`.
 */

import * as icons from "@/eta/icons"
import { DialogEvent } from "@/config/dialog-events"
import { WindowEvent } from "@/config/window-events"
import { DIALOG_OVERLAY_ID } from "@/services/dialog-service"
import { appEvents, AppEvent } from "@/stores/app-events"
import renderWindowFrame from "@/eta/views/window/window-frame"

const OVERLAY_ID = "inb4doc-window-overlay"
const DEFAULT_BOX_CLASS = "window-dialog"

/**
 * `"close"` renders a single Close button (Preferences, About, images).
 * `"confirm"` renders Cancel + Accept (anything with a destructive or
 * multi-step outcome, e.g. switching the storage backend).
 */
export type WindowMode = "close" | "confirm"

export interface WindowHostOptions {
  /** Header title — every window in the app carries one. */
  title: string
  /** Optional de-emphasised suffix next to the title (a scope, a path…). */
  subtitle?: string
  /** Action row: Close vs Cancel/Accept. Defaults to `"close"`. */
  mode?: WindowMode
  /** Extra class on the box for width tweaks (`prefs-dialog`, `about-dialog`). */
  boxClass?: string
  /** Initial `enabled` state of the Accept button (`"confirm"` mode). */
  acceptEnabled?: boolean
  /** Extra events to listen for on the layer (same shape as dialog-service). */
  listeners?: Record<string, (e: Event) => void>
  onClose?: () => void
  /** Called when this window becomes the visible one again (a child closed). */
  onResume?: () => void
}

export interface WindowHandle<T> {
  promise: Promise<T | null>
  /** The mounted frame (null when the window failed to mount). */
  layer: HTMLElement | null
  close: (value?: T) => void
}

interface WindowSession {
  id: string
  sessionId: string
  payload: unknown
  title: string
  subtitle?: string
  mode: WindowMode
  boxClass: string
  acceptEnabled: boolean
  listeners?: Record<string, (e: Event) => void>
  onClose?: () => void
  onResume?: () => void
  layer: HTMLElement | null
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  cleanup: () => void
}

// ── Host ───────────────────────────────────────────────────────────

const stack: WindowSession[] = []
let overlay: HTMLDivElement | null = null
let escapeWired = false

function ensureOverlay(): HTMLDivElement {
  if (overlay?.isConnected) return overlay
  const el = document.createElement("div")
  el.id = OVERLAY_ID
  // Clicking the dimmed area dismisses the topmost window only — a parent
  // window below it stays open and is revealed again.
  el.addEventListener("click", (e: MouseEvent) => {
    if (e.target === el) closeTopWindow()
  })
  document.body.appendChild(el)
  overlay = el
  return el
}

function disposeOverlay(): void {
  overlay?.remove()
  overlay = null
}

/**
 * Only the topmost layer is visible. Hidden layers keep their DOM (and their
 * Stimulus controller) so returning to them restores scroll position and
 * half-filled form state instead of a fresh mount.
 */
function syncVisibility(): void {
  const top = stack[stack.length - 1]
  for (const session of stack) {
    if (session.layer) session.layer.hidden = session !== top
  }
}

function mountWindow(session: WindowSession): void {
  const host = ensureOverlay()

  const frame = document.createElement("div")
  frame.innerHTML = renderWindowFrame({
    id: session.id,
    sessionId: session.sessionId,
    title: session.title,
    subtitle: session.subtitle,
    mode: session.mode,
    boxClass: session.boxClass,
    acceptEnabled: session.acceptEnabled,
    icons: icons as Record<string, string>,
  })
  const layer = frame.firstElementChild as HTMLElement | null
  if (!layer) return
  session.layer = layer

  // The body host is where this window's Stimulus controller mounts. It gets
  // its payload exactly like dialog-service does, so existing `payloadValue`
  // based controllers work unchanged.
  const bodyHost = layer.querySelector<HTMLElement>("[data-window-body]")
  let controllerEl: HTMLElement | null = null
  if (bodyHost) {
    controllerEl = document.createElement("div")
    controllerEl.dataset.controller = session.id
    // Accept is the one frame button whose meaning the body owns: deliver the
    // click to it as an action on its own scope (to the manager the press is
    // just another button).
    if (session.mode === "confirm") {
      controllerEl.dataset.action = `${WindowEvent.AcceptRequest}->${session.id}#accept`
    }
    controllerEl.setAttribute(
      `data-${session.id}-payload-value`,
      JSON.stringify(session.payload ?? {}),
    )
    bodyHost.appendChild(controllerEl)
  }

  const finish = (value: unknown) => finishSession(session.sessionId, value)
  const onFrameClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-window-action]",
    )
    if (!btn || (btn as HTMLButtonElement).disabled) return
    const action = btn.dataset.windowAction
    if (action === "accept") {
      controllerEl?.dispatchEvent(new CustomEvent(WindowEvent.AcceptRequest))
      return
    }
    // `close` (header X + Close) and `cancel` both dismiss with no value.
    finish(null)
  }
  const onAcceptToggle = ((e: CustomEvent<{ enabled?: boolean }>) => {
    const btn = layer.querySelector<HTMLButtonElement>("[data-window-accept]")
    if (btn) btn.disabled = e.detail?.enabled !== true
  }) as EventListener
  const onConfirm = ((e: CustomEvent) => finish(e.detail)) as EventListener
  const onCancel = () => finish(null)

  layer.addEventListener("click", onFrameClick)
  layer.addEventListener(DialogEvent.Confirm, onConfirm)
  layer.addEventListener(DialogEvent.Cancel, onCancel)
  layer.addEventListener(WindowEvent.SetAcceptEnabled, onAcceptToggle)

  if (session.listeners) {
    for (const [event, fn] of Object.entries(session.listeners)) {
      layer.addEventListener(event, fn as EventListener)
    }
  }

  session.cleanup = () => {
    layer.removeEventListener("click", onFrameClick)
    layer.removeEventListener(DialogEvent.Confirm, onConfirm)
    layer.removeEventListener(DialogEvent.Cancel, onCancel)
    layer.removeEventListener(WindowEvent.SetAcceptEnabled, onAcceptToggle)
    if (session.listeners) {
      for (const event of Object.keys(session.listeners)) {
        layer.removeEventListener(event, session.listeners[event] as EventListener)
      }
    }
    layer.remove()
  }

  host.appendChild(layer)
  syncVisibility()
  wireEscape()
}

function finishSession(sessionId: string, value: unknown): void {
  const index = stack.findIndex((s) => s.sessionId === sessionId)
  if (index === -1) return
  const [session] = stack.splice(index, 1)
  session.cleanup()
  session.layer = null
  session.onClose?.()
  session.resolve(value)
  session.cleanup = () => {}

  if (!stack.length) {
    disposeOverlay()
    return
  }
  syncVisibility()
  const top = stack[stack.length - 1]
  top.onResume?.()
  appEvents.emit(AppEvent.WindowResumed, { id: top.id })
}

// ── Escape ─────────────────────────────────────────────────────────
//
// Owned by src/plugins/keyboard.ts (the app's single document keydown
// listener); here it cancels the topmost window. A modal dialog sits above the
// window stack, so while one is mounted Escape belongs to it and the stack
// stays put.

function wireEscape(): void {
  if (escapeWired) return
  escapeWired = true
  appEvents.on(AppEvent.Escape, () => {
    if (!stack.length) return
    if (document.getElementById(DIALOG_OVERLAY_ID)) return
    closeTopWindow()
  })
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Open a managed window. Returns immediately; the promise resolves with the
 * confirm value, or `null` on cancel/dismiss.
 *
 * Re-opening a window id that is already open returns the *existing* handle
 * (same promise, same layer) so a double click can't stack duplicates.
 */
export function openWindow<T = unknown>(
  id: string,
  payload: unknown,
  options: WindowHostOptions,
): WindowHandle<T> {
  const existing = stack.find((s) => s.id === id)
  if (existing) {
    return {
      promise: existing.promise as Promise<T | null>,
      layer: existing.layer,
      close: (value?: T) => finishSession(existing.sessionId, value ?? null),
    }
  }

  const sessionId = Math.random().toString(36).slice(2)
  let resolveLater!: (value: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    resolveLater = resolve
  })
  const session: WindowSession = {
    id,
    sessionId,
    payload,
    title: options.title,
    subtitle: options.subtitle,
    mode: options.mode ?? "close",
    boxClass: options.boxClass ?? DEFAULT_BOX_CLASS,
    acceptEnabled: options.acceptEnabled ?? options.mode !== "confirm",
    listeners: options.listeners,
    onClose: options.onClose,
    onResume: options.onResume,
    layer: null,
    promise,
    resolve: resolveLater,
    cleanup: () => {},
  }
  stack.push(session)

  mountWindow(session)
  return {
    promise: promise as Promise<T | null>,
    layer: session.layer,
    close: (value?: T) => finishSession(sessionId, (value ?? null) as unknown),
  }
}

/**
 * Dismiss the topmost window, revealing its parent (if any). Returns true when
 * there was one — used by the host "back" affordance, after modal dialogs,
 * which sit above the stack.
 */
export function closeTopWindow(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  finishSession(top.sessionId, null)
  return true
}

/** Enable/disable the Accept button of the frame hosting `el`. */
export function setWindowAcceptEnabled(el: Element | null, enabled: boolean): void {
  if (!el) return
  el.dispatchEvent(
    new CustomEvent(WindowEvent.SetAcceptEnabled, {
      detail: { enabled },
      bubbles: true,
    }),
  )
}
