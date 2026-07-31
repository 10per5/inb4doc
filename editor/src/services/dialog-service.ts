import { DialogEvent } from "@/config/dialog-events"
import { appState, type DialogState } from "@/stores/app-state"

const OVERLAY_ID = "inb4doc-dialog-overlay"

function createOverlay(classname?: string): HTMLDivElement {
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) existing.remove()
  const overlay = document.createElement("div")
  overlay.id = OVERLAY_ID
  if (classname) overlay.className = classname
  document.body.appendChild(overlay)
  return overlay
}

// ── Dialog host (state-driven) ──────────────────────────────────────
//
// The host tracks the open dialog in AppState. openDialog() sets
// appState.dialog; the host's subscription mounts a `<div data-controller=
// "<id>" data-<id>-payload-value="…" data-dialog-session="…">` wrapper whose
// controller injects its own paired-eta view in connect(). dialog:confirm /
// dialog:cancel (bubbled from the controller) resolve the per-session promise
// and clear the state, so the next open self-mounts fresh (swapped) code.

interface DialogSession {
  id: string
  sessionId: string
  resolve: (value: unknown) => void
  listeners?: Record<string, (e: Event) => void>
  onClose?: () => void
  cleanup: () => void
}

const sessions = new Map<string, DialogSession>()

let hostReady = false

export interface DialogHostOptions {
  onClose?: () => void
  listeners?: Record<string, (e: Event) => void>
}

export interface DialogOpenResult<T> {
  promise: Promise<T | null>
  overlay: HTMLDivElement
  close: (value?: T) => void
}

function finishSession(sessionId: string, value: unknown): void {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  session.cleanup()
  session.onClose?.()
  session.resolve(value)
  if (appState.get("dialog")?.sessionId === sessionId) {
    appState.set("dialog", null)
  }
}

function mountDialog(state: DialogState): void {
  const session = sessions.get(state.sessionId)
  if (!session) return

  // Opening a new dialog while one is open silently closes the previous one.
  const current = appState.get("dialog")
  if (current && current.sessionId !== state.sessionId) {
    finishSession(current.sessionId, null)
  }

  const overlay = createOverlay()

  const wrapper = document.createElement("div")
  wrapper.dataset.controller = state.id
  wrapper.dataset.dialogSession = state.sessionId
  wrapper.setAttribute(`data-${state.id}-payload-value`, JSON.stringify(state.payload ?? {}))
  overlay.appendChild(wrapper)

  if (session.listeners) {
    for (const [event, fn] of Object.entries(session.listeners)) {
      overlay.addEventListener(event, fn as EventListener)
    }
  }

  const finish = (value: unknown) => finishSession(state.sessionId, value)
  const onResolve = ((e: CustomEvent) => finish(e.detail)) as EventListener
  const onCancel = () => finish(null)
  const onBackdrop = (e: Event) => {
    if (e.target === overlay) finish(null)
  }
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(null)
  }

  overlay.addEventListener(DialogEvent.Confirm, onResolve)
  overlay.addEventListener(DialogEvent.Cancel, onCancel)
  overlay.addEventListener("click", onBackdrop)
  document.addEventListener("keydown", onKeydown)

  session.cleanup = () => {
    overlay.removeEventListener(DialogEvent.Confirm, onResolve)
    overlay.removeEventListener(DialogEvent.Cancel, onCancel)
    overlay.removeEventListener("click", onBackdrop)
    document.removeEventListener("keydown", onKeydown)
    if (session.listeners) {
      for (const event of Object.keys(session.listeners)) {
        overlay.removeEventListener(event, session.listeners[event] as EventListener)
      }
    }
    overlay.remove()
  }
}

function ensureHost(): void {
  if (hostReady) return
  hostReady = true
  appState.on("dialog", (state) => {
    if (state) mountDialog(state)
  })
}

export function openDialog<T = unknown>(
  id: string,
  payload?: unknown,
  options: DialogHostOptions = {}
): DialogOpenResult<T> {
  ensureHost()
  const sessionId = Math.random().toString(36).slice(2)

  const result = {} as DialogOpenResult<T>
  const promise = new Promise<T | null>((resolve) => {
    sessions.set(sessionId, {
      id,
      sessionId,
      resolve: resolve as (value: unknown) => void,
      listeners: options.listeners,
      onClose: options.onClose,
      cleanup: () => {},
    })
    appState.set("dialog", { id, sessionId, payload })
  })
  result.promise = promise
  result.overlay = document.getElementById(OVERLAY_ID) as HTMLDivElement
  result.close = (value?: T) => finishSession(sessionId, (value ?? null) as unknown)
  return result
}

// ── Legacy API (html string + Stimulus) ─────────────────────────────

export interface DialogHandle {
  close: () => void
  el: HTMLDivElement
}

export interface HtmlDialogOptions {
  class?: string
  onClose?: () => void
  html: string
}

export function openHtmlDialog(opts: HtmlDialogOptions): DialogHandle {
  const overlay = createOverlay(opts.class)
  overlay.innerHTML = opts.html

  const close = () => {
    opts.onClose?.()
    document.removeEventListener("keydown", onKeydown)
    overlay.remove()
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close()
  }
  document.addEventListener("keydown", onKeydown)

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close()
  })

  return { close, el: overlay }
}

export interface HtmlDialogPromiseOptions<T> {
  class?: string
  onClose?: () => void
  html: string
  resolveEvent?: string
  cancelEvent?: string
}

export function openHtmlDialogPromise<T = void>(opts: HtmlDialogPromiseOptions<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const overlay = createOverlay(opts.class)
    overlay.innerHTML = opts.html

    const resolveEvent = opts.resolveEvent ?? DialogEvent.Confirm
    const cancelEvent = opts.cancelEvent ?? DialogEvent.Cancel

    const finish = (value: T | null) => {
      document.removeEventListener("keydown", onKeydown)
      overlay.removeEventListener(resolveEvent, onResolve)
      overlay.removeEventListener(cancelEvent, onCancel)
      overlay.remove()
      resolve(value)
    }

    const onResolve = ((e: CustomEvent) => finish(e.detail)) as EventListener
    const onCancel = () => finish(null)

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null)
    }
    document.addEventListener("keydown", onKeydown)

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null)
    })

    overlay.addEventListener(resolveEvent, onResolve)
    overlay.addEventListener(cancelEvent, onCancel)

    if (opts.onClose) {
      const origClose = opts.onClose
      opts.onClose = () => { origClose(); finish(null) }
    }
  })
}

// ── Legacy promise API (html string + Stimulus) ─────────────────────
