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
