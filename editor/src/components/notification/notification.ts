import { colors } from "@/config/theme";
import { x, warningCircle, infoCircle, checkCircle } from "@/eta/icons";

export type NotificationType = "danger" | "info" | "warning" | "success";

export interface NotificationOptions {
  title?: string;
  duration?: number;
  type?: NotificationType;
  id?: string;
}

const DEFAULT_DURATION = 4000;

const NOTIFICATION_BG: Record<NotificationType, string> = {
  danger: "#e03e3e",
  warning: "#d08731",
  info: "#388bf2",
  success: "#2ea043",
};

const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  danger: x,
  warning: warningCircle,
  info: infoCircle,
  success: checkCircle,
};

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = document.getElementById("prdc-notifications") as HTMLElement;
    if (!container) {
      container = document.createElement("div");
      container.id = "prdc-notifications";
      document.body.appendChild(container);
    }
  }
  return container;
}

export function showNotification(msg: string, opts?: NotificationOptions): void {
  const duration = opts?.duration ?? DEFAULT_DURATION;
  const type = opts?.type ?? "danger";
  const title = opts?.title;
  const id = opts?.id;

  const c = getContainer();

  if (id) {
    const existing = c.querySelector(`[data-nid="${id}"]`);
    if (existing) existing.remove();
  }

  const el = document.createElement("div");
  el.className = "prdc-notification";
  el.style.background = NOTIFICATION_BG[type];
  if (id) el.dataset.nid = id;

  const closeEl = document.createElement("button");
  closeEl.className = "prdc-notif-close";
  closeEl.innerHTML = x;
  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
  });
  el.appendChild(closeEl);

  const iconEl = document.createElement("span");
  iconEl.className = "prdc-notif-icon";
  iconEl.innerHTML = NOTIFICATION_ICONS[type];
  el.appendChild(iconEl);

  const bodyEl = document.createElement("div");
  bodyEl.className = "prdc-notif-body";
  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "prdc-notif-title";
    titleEl.textContent = title;
    bodyEl.appendChild(titleEl);
  }
  const msgEl = document.createElement("div");
  msgEl.className = "prdc-notif-msg";
  msgEl.textContent = msg;
  bodyEl.appendChild(msgEl);
  el.appendChild(bodyEl);

  c.appendChild(el);

  if (duration > 0) {
    const anim = el.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-8px)" },
      ],
      {
        duration: 300,
        fill: "forwards",
        delay: duration - 300,
        easing: "ease-out",
      },
    );
    anim.onfinish = () => { if (el.isConnected) el.remove() };
    closeEl.addEventListener("click", () => anim.cancel());
  }
}

export function initNotifications(): void {
  if (document.getElementById("prdc-notification-styles")) return;

  const style = document.createElement("style");
  style.id = "prdc-notification-styles";
  style.textContent = `
#prdc-notifications {
  position: fixed; bottom: 1rem; right: 1rem; z-index: 100000;
  display: flex; flex-direction: column; gap: 0.5rem;
  pointer-events: none;
  max-width: min(90vw, 400px);
}
.prdc-notification {
  pointer-events: auto;
  position: relative;
  display: flex; align-items: flex-start; gap: 0.625rem;
  color: #fff; padding: 0.625rem 0.875rem;
  border-radius: 10px;
  font: 13px/1.45 system-ui, sans-serif;
  box-shadow: 0 4px 16px rgba(0,0,0,.45);
  animation: prdc-notif-in .2s ease-out;
  min-width: 240px;
}
.prdc-notif-close {
  position: absolute; top: 4px; right: 4px;
  width: 1.25rem; height: 1.25rem; padding: 0; border: none; cursor: pointer;
  display: none; align-items: center; justify-content: center;
  font-size: 10px; line-height: 1;
  border-radius: 50%; background: rgba(0,0,0,.25); color: #fff;
}
.prdc-notification:hover .prdc-notif-close { display: flex; }
.prdc-notif-icon {
  flex-shrink: 0; width: 1.25rem; height: 1.25rem;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  border-radius: 50%;
  background: rgba(0,0,0,.2);
  margin-top: 1px;
}
.prdc-notif-icon svg { width: 100%; height: 100%; }
.prdc-notif-body {
  flex: 1; min-width: 0;
}
.prdc-notif-title {
  font-weight: 600; margin-bottom: 0.125rem;
}
.prdc-notif-msg {
  opacity: .88;
}
@keyframes prdc-notif-in {
  from { opacity: 0; transform: translateX(100%); }
  to   { opacity: 1; transform: translateX(0); }
}
  `;
  document.head.appendChild(style);
}
