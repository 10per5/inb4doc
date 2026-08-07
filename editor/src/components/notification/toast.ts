const DEFAULT_DURATION = 4000;

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

export function showToast(msg: string, opts?: ToastOptions) {
  const duration = opts?.duration ?? DEFAULT_DURATION;
  const type = opts?.type ?? "danger";

  const old = document.getElementById("prdc-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "prdc-toast";
  toast.textContent = msg;
  toast.style.background = TOAST_BG[type];
  document.body.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
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
  const old = document.getElementById("prdc-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "prdc-toast";
  toast.className = "prdc-toast prdc-toast-action";
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
  const old = document.getElementById("prdc-toast");
  if (old) old.remove();

  const el = document.createElement("div");
  el.id = "prdc-toast";
  el.className = "prdc-toast prdc-toast-progress";

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
