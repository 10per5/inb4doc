import { isMobileDock } from "@/utils/mobile";

const DEFAULT_DURATION = 4000;
// Mobile transient toasts auto-dismiss faster so they never linger over typing.
const MOBILE_DURATION = 2400;

export type ToastType = "danger" | "warning" | "info";

export interface ToastOptions {
  duration?: number;
  type?: ToastType;
}

const TOAST_BG: Record<ToastType, string> = {
  danger: "#e03e3e",
  warning: "#d08731",
  info: "#388bf2",
};

// Semi-transparent variants (8-digit hex, ~85% alpha) for the mobile toast.
const TOAST_BG_MOBILE: Record<ToastType, string> = {
  danger: "#e03e3ed9",
  warning: "#d08731d9",
  info: "#388bf2d9",
};

// The mobile transient toast is pointer-events:none (phantom touch), so a tap
// on its body passes through to the editor underneath. Dismiss gestures are
// captured with capture-phase window listeners while the toast is mounted and
// torn down on dismiss/replace. This is a transient touch-gesture capture
// scoped to the toast lifetime, not a global keyboard binding (keyboard.ts owns
// those).
const gestureCleanup = new WeakMap<HTMLElement, () => void>();

function removeCurrentToast(): void {
  const old = document.getElementById("prdc-toast");
  if (!old) return;
  gestureCleanup.get(old)?.();
  gestureCleanup.delete(old);
  old.remove();
}

// Slide the toast out (offsetX = travel direction in px) then remove it.
function dismiss(toast: HTMLElement, offsetX: number): void {
  if (!toast.isConnected) return;
  gestureCleanup.get(toast)?.();
  gestureCleanup.delete(toast);
  toast.style.transition = "transform 0.18s ease, opacity 0.18s ease";
  toast.style.transform = `translateX(calc(-50% + ${offsetX}px))`;
  toast.style.opacity = "0";
  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, 200);
}

// Horizontal swipe anywhere on the toast body slides it out. Capture-phase
// window listeners still see the pointer even though the toast is
// pointer-events:none; a plain tap inside the band is left untouched so the
// editor underneath still receives it (phantom touch) — only a confirmed
// horizontal drag engages the gesture.
function attachSwipeDismiss(toast: HTMLElement): void {
  let active = false;
  let engaged = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;

  const onDown = (e: PointerEvent): void => {
    if (!toast.isConnected) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const r = toast.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    active = true;
    engaged = false;
    dx = 0;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onMove = (e: PointerEvent): void => {
    if (!active || !toast.isConnected) return;
    const x = e.clientX - startX;
    const y = e.clientY - startY;
    if (!engaged) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      // Vertical drags stay free (scrolling); only horizontal ones dismiss.
      if (Math.abs(y) > Math.abs(x)) {
        active = false;
        return;
      }
      engaged = true;
      e.preventDefault();
    }
    dx = x;
    toast.style.transform = `translateX(calc(-50% + ${x}px))`;
    toast.style.opacity = String(Math.max(0.3, 1 - Math.abs(x) / 240));
  };

  const onUp = (e: PointerEvent): void => {
    if (!active) return;
    active = false;
    if (!engaged) return;
    e.preventDefault();
    if (Math.abs(dx) > 56) {
      dismiss(toast, dx > 0 ? 160 : -160);
    } else {
      toast.style.transition = "transform 0.15s ease, opacity 0.15s ease";
      toast.style.transform = "translateX(-50%)";
      toast.style.opacity = "";
      setTimeout(() => {
        toast.style.transition = "";
      }, 160);
    }
  };

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);

  gestureCleanup.set(toast, () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  });
}

export function showToast(msg: string, opts?: ToastOptions) {
  const mobile = isMobileDock();
  const duration = opts?.duration ?? (mobile ? MOBILE_DURATION : DEFAULT_DURATION);
  const type = opts?.type ?? "danger";

  removeCurrentToast();

  const toast = document.createElement("div");
  toast.id = "prdc-toast";
  if (mobile) {
    toast.className = "prdc-toast prdc-toast--mobile";
    toast.style.background = TOAST_BG_MOBILE[type];

    const msgEl = document.createElement("span");
    msgEl.className = "prdc-toast-msg";
    msgEl.textContent = msg;
    toast.appendChild(msgEl);

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "prdc-toast-dismiss";
    handle.setAttribute("aria-label", "Dismiss");
    handle.textContent = "✕";
    handle.addEventListener("click", () => dismiss(toast, 0));
    toast.appendChild(handle);

    attachSwipeDismiss(toast);
  } else {
    toast.style.background = TOAST_BG[type];
    toast.textContent = msg;
  }
  document.body.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.isConnected) dismiss(toast, 0);
    }, duration);
  }
}

export interface ProgressToastHandle {
  updateProgress(loaded: number, total: number): void
  setMessage(msg: string): void
  remove(): void
}

const ACTION_BTN_STYLE = [
  "margin-left:0.75rem",
  "padding:0.25rem 0.9rem",
  "border:1px solid rgba(255,255,255,0.55)",
  "border-radius:4px",
  "background:transparent",
  "color:inherit",
  "font:inherit",
  "font-weight:600",
  "cursor:pointer",
  "white-space:nowrap",
].join(";");

// A persistent toast with a single action button, used for updates that cannot
// be applied in place (entry pot / shell / stateful pot changed). It replaces
// any current toast via the shared #prdc-toast id and stays until the user
// acts — no auto-dismiss, so the page never reloads (or loses the prompt)
// while the user is mid-edit.
export function showActionToast(
  msg: string,
  actionLabel: string,
  onAction: () => void,
  opts?: { type?: ToastType }
): void {
  removeCurrentToast();

  const toast = document.createElement("div");
  toast.id = "prdc-toast";
  toast.className = isMobileDock()
    ? "prdc-toast prdc-toast-action prdc-toast--mobile"
    : "prdc-toast prdc-toast-action";
  toast.style.background = TOAST_BG[opts?.type ?? "danger"];

  const msgEl = document.createElement("span");
  msgEl.textContent = msg;
  toast.appendChild(msgEl);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = actionLabel;
  btn.style.cssText = ACTION_BTN_STYLE;
  btn.addEventListener("click", () => {
    toast.remove();
    onAction();
  });
  toast.appendChild(btn);

  document.body.appendChild(toast);
}

const PROGRESS_COLOR = "#388bf2";

const INDETERMINATE_KEYFRAMES = `@keyframes prdc-toast-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`;

export function showProgressToast(initialMsg: string): ProgressToastHandle {
  removeCurrentToast();

  const el = document.createElement("div");
  el.id = "prdc-toast";
  el.className = isMobileDock()
    ? "prdc-toast prdc-toast-progress prdc-toast--mobile"
    : "prdc-toast prdc-toast-progress";

  const msgEl = document.createElement("div");
  msgEl.textContent = initialMsg;
  msgEl.style.padding = "0.75rem 1.25rem 0.5rem";
  el.appendChild(msgEl);

  const barWrap = document.createElement("div");
  barWrap.style.cssText = "height:4px;background:#333;margin:0 1.25rem 0.75rem;border-radius:2px;overflow:hidden;";
  const bar = document.createElement("div");
  bar.style.cssText = "height:100%;width:0%;background:" + PROGRESS_COLOR + ";transition:width .3s ease;border-radius:2px;";
  barWrap.appendChild(bar);
  el.appendChild(barWrap);

  // One shared keyframe rule for the indeterminate state.
  if (!document.getElementById("prdc-toast-style")) {
    const style = document.createElement("style");
    style.id = "prdc-toast-style";
    style.textContent = INDETERMINATE_KEYFRAMES;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);

  function setIndeterminate(): void {
    bar.style.transition = "none";
    bar.style.animation = "prdc-toast-slide 1.2s ease-in-out infinite";
    bar.style.width = "33%";
  }

  // No size is known until the SW reports one, so start indeterminate.
  setIndeterminate();

  return {
    updateProgress(loaded: number, total: number): void {
      if (total > 0) {
        bar.style.animation = "none";
        bar.style.transition = "width .3s ease";
        bar.style.width =
          Math.min(100, Math.round((loaded / total) * 100)) + "%";
      } else {
        setIndeterminate();
      }
    },
    setMessage(msg: string): void {
      msgEl.textContent = msg;
    },
    remove(): void {
      el.remove();
    },
  };
}
