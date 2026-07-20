import { DialogEvent } from "@/controllers/dialog/dialog-events"

const OVERLAY_ID = "inb4doc-dialog-overlay"

const overlayCss = `
#${OVERLAY_ID} {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 1000; display: flex; align-items: center; justify-content: center;
}
#${OVERLAY_ID} > * { pointer-events: auto; }
`

let styleInjected = false

function injectStyles() {
  if (styleInjected) return
  styleInjected = true
  const s = document.createElement("style")
  s.textContent = overlayCss
  document.head.appendChild(s)
}

function createOverlay(classname?: string): HTMLDivElement {
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) existing.remove()
  injectStyles()
  const overlay = document.createElement("div")
  overlay.id = OVERLAY_ID
  if (classname) overlay.className = classname
  document.body.appendChild(overlay)
  return overlay
}

// ── Legacy API (render callback) ─────────────────────────────────────

export interface DialogOptions {
  class?: string
  onClose?: () => void
  render: (overlay: HTMLDivElement) => (void | (() => void))
}

export interface DialogHandle {
  close: () => void
  el: HTMLDivElement
}

export function openDialog(opts: DialogOptions): DialogHandle {
  const overlay = createOverlay(opts.class)

  let cleanup: (() => void) | void

  const close = () => {
    cleanup?.()
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

  cleanup = opts.render(overlay)

  return { close, el: overlay }
}

// ── New API (html string + Stimulus) ─────────────────────────────────

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

// ── Legacy promise API (render callback) ─────────────────────────────

export function openDialogPromise<T>(opts: {
  class?: string
  render: (overlay: HTMLDivElement, resolve: (value: T) => void) => void | (() => void)
}): Promise<T> {
  return new Promise<T>((resolve) => {
    const overlay = createOverlay(opts.class)

    let cleanup: (() => void) | void

    const finish = (value: T) => {
      cleanup?.()
      document.removeEventListener("keydown", onKeydown)
      overlay.remove()
      resolve(value)
    }

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null as T)
    }
    document.addEventListener("keydown", onKeydown)

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null as T)
    })

    cleanup = opts.render(overlay, finish)
  })
}
