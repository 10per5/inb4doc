import { colors } from "@/config/theme";

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

  // Remove existing toast if present
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

export function initToast() {
  // Inject styles if not already present
  if (!document.getElementById("prdc-toast-styles")) {
    const style = document.createElement("style");
    style.id = "prdc-toast-styles";
    style.textContent = `
#prdc-toast {
  position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 100000;
  background: ${colors.dark}; color: ${colors.lighterBg}; padding: 0.75rem 1.25rem;
  border-radius: 8px; font: 13px/1.4 system-ui, sans-serif;
  box-shadow: 0 4px 16px rgba(0,0,0,.45);
  white-space: pre-wrap; text-align: center;
  max-width: min(90vw, 500px);
  animation: prdc-toast-in .2s ease-out;
}
@keyframes prdc-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-0.5rem); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
        `;
    document.head.appendChild(style);
  }
}

