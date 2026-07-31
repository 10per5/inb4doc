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

const PROGRESS_COLOR = "#388bf2";

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

  document.body.appendChild(el);

  return {
    updateProgress(loaded: number, total: number): void {
      const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      bar.style.width = pct + "%";
    },
    setMessage(msg: string): void {
      msgEl.textContent = msg;
    },
    remove(): void {
      el.remove();
    },
  };
}
