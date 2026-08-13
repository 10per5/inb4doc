import { colors } from "@/config/theme";
import { xmark, warningCircle, infoCircle, checkCircle } from "@/eta/icons";
import { isMobileDock } from "@/utils/mobile";

export type NotificationType = "danger" | "info" | "warning" | "success";

export interface NotificationOptions {
  title?: string;
  duration?: number;
  type?: NotificationType;
  id?: string;
}

const DEFAULT_DURATION = 4000;
// Mobile notifications auto-dismiss faster so they never linger over typing.
const MOBILE_DURATION = 2400;

const NOTIFICATION_BG: Record<NotificationType, string> = {
  danger: "#e03e3e",
  warning: "#d08731",
  info: "#388bf2",
  success: "#2ea043",
};

// Semi-transparent variants (8-digit hex, ~85% alpha) for the mobile stack.
const NOTIFICATION_BG_MOBILE: Record<NotificationType, string> = {
  danger: "#e03e3ed9",
  warning: "#d08731d9",
  info: "#388bf2d9",
  success: "#2ea043d9",
};

const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  danger: xmark,
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

// Slide a card out (offsetX = travel direction in px) then remove it.
function dismissCard(el: HTMLElement, anim: Animation | null, offsetX: number): void {
  anim?.cancel();
  const out = el.animate(
    [{ transform: `translateX(${offsetX}px)`, opacity: 0 }],
    { duration: 180, easing: "ease-in", fill: "forwards" },
  );
  out.onfinish = () => { if (el.isConnected) el.remove() };
}

// Horizontal swipe on a card dismisses it. Element-scoped listeners (no
// window/document bindings): cards are pointer-events:auto so the gesture is
// captured directly. touch-action: pan-y (CSS) keeps vertical pans on the page
// scrolling. A swipe starting on the ✕ close button is left to the button.
function attachCardSwipe(el: HTMLElement, anim: Animation | null): void {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let active = false;
  let engaged = false;

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".prdc-notif-close")) return;
    active = true;
    engaged = false;
    dx = 0;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onMove = (e: PointerEvent): void => {
    if (!active) return;
    const x = e.clientX - startX;
    const y = e.clientY - startY;
    if (!engaged) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      // Vertical pans stay free (browser scrolls via touch-action: pan-y);
      // only horizontal swipes dismiss.
      if (Math.abs(y) > Math.abs(x)) {
        active = false;
        return;
      }
      engaged = true;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    dx = x;
    el.style.transform = `translateX(${x}px)`;
    el.style.opacity = String(Math.max(0.3, 1 - Math.abs(x) / 240));
  };

  const onUp = (e: PointerEvent): void => {
    if (!active) return;
    active = false;
    if (!engaged) return;
    e.preventDefault();
    if (Math.abs(dx) > 56) {
      dismissCard(el, anim, dx > 0 ? 160 : -160);
    } else {
      el.style.transition = "transform 0.15s ease, opacity 0.15s ease";
      el.style.transform = "";
      el.style.opacity = "";
      setTimeout(() => { el.style.transition = "" }, 150);
    }
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

export function showNotification(msg: string, opts?: NotificationOptions): void {
  const mobile = isMobileDock();
  const duration = opts?.duration ?? (mobile ? MOBILE_DURATION : DEFAULT_DURATION);
  const type = opts?.type ?? "danger";
  const title = opts?.title;
  const id = opts?.id;

  const c = getContainer();
  c.classList.toggle("prdc-notifications--mobile", mobile);

  if (id) {
    const existing = c.querySelector(`[data-nid="${id}"]`);
    if (existing) existing.remove();
  }

  const el = document.createElement("div");
  el.className = "prdc-notification";
  el.style.background = mobile ? NOTIFICATION_BG_MOBILE[type] : NOTIFICATION_BG[type];
  if (id) el.dataset.nid = id;

  const closeEl = document.createElement("button");
  closeEl.className = "prdc-notif-close";
  closeEl.innerHTML = xmark;
  let anim: Animation | null = null;
  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    anim?.cancel();
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
    anim = el.animate(
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
  }

  if (mobile) attachCardSwipe(el, anim);
}
