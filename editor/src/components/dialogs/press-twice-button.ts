import { buttonVariants, type ButtonVariant } from "../../theme"

export interface PressTwiceButtonOptions {
  idleText: string
  pendingText: string
  variant: ButtonVariant
  onConfirm: () => void
  timeout?: number
  small?: boolean
  idleBadge?: string
}

export function pressTwiceButton(opts: PressTwiceButtonOptions): HTMLButtonElement {
  const btn = document.createElement("button")
  const timeoutMs = opts.timeout ?? 3000
  let pending = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  Object.assign(btn.style, {
    padding: opts.small ? "0.25rem 0.6rem" : "0.4rem 1.2rem",
    fontSize: opts.small ? "0.8rem" : "0.9rem",
    borderRadius: "4px",
    cursor: "pointer",
    border: "none",
    transition: "background 0.15s",
  })

  function applyVariant() {
    const v = buttonVariants[opts.variant]
    const s = pending ? v.pending : v.idle
    btn.style.background = s.bg
    btn.style.color = s.color
    if (pending) {
      btn.textContent = opts.pendingText
    } else if (opts.idleBadge) {
      btn.innerHTML = `${opts.idleText} <span style="font-size:0.7rem;opacity:0.85">${opts.idleBadge}</span>`
    } else {
      btn.textContent = opts.idleText
    }
  }

  function reset() {
    pending = false
    if (timeoutId !== null) clearTimeout(timeoutId)
    timeoutId = null
    applyVariant()
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (pending) {
      if (timeoutId !== null) clearTimeout(timeoutId)
      timeoutId = null
      opts.onConfirm()
    } else {
      pending = true
      applyVariant()
      timeoutId = setTimeout(reset, timeoutMs)
    }
  })

  applyVariant()
  return btn
}
