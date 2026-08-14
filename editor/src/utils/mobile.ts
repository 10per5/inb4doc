import { hasFunc, AppFunc, BuildMode, currentBuildMode } from "$/build/build-mode";

const MOBILE_VIEWPORT_MQ = "(max-width: 767px)";

// Tablet breakpoint, mirrored from the CSS (#edit-toolbar quick bar and dock
// CSS in conditions.css use 768–1199px as the tablet range).
const TABLET_VIEWPORT_MQ = "(min-width: 768px) and (max-width: 1199px)";

// The web chrome is chosen by viewport WIDTH, not by UA: a tablet in landscape
// (e.g. iPad at 1210px) gets the desktop toolbar even though its UA says
// "Mobile". The rest of the layout can stay mobile-like via the Focused default.
// Must mirror the inline pre-paint script in shell.eta
// (mobile-layout/desktop-layout classes).
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_VIEWPORT_MQ).matches;
}

export function isTabletViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(TABLET_VIEWPORT_MQ).matches;
}

// Runtime "is the mobile dock layout active right now?" check. hasFunc stays a
// pure build-capability lookup (SUPPORTED_MODES) — it does NOT gate the dock on
// the viewport. Consumers of the dock must call this explicitly instead of
// hasFunc(AppFunc.MobileDock): the native mobile host always uses the dock,
// while web builds (which ship the dock markup for phone testing) engage it only
// on a mobile viewport.
export function isMobileDock(): boolean {
  if (!hasFunc(AppFunc.MobileDock)) return false;
  return currentBuildMode() === BuildMode.GuiMobile || isMobileViewport();
}

// UA signal for phones/tablets (Android, iOS, Touch phones). The layout gates
// on viewport WIDTH (isMobileViewport), but some behaviors must also engage on
// tablets whose width crosses into the desktop breakpoint (e.g. the
// edit-toolbar follow mode when the on-screen keyboard opens). UA detection is
// an additional gate on top of the viewport — never a replacement for it, so a
// tablet in landscape keeps its desktop chrome.
const MOBILE_OR_TABLET_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i;

export function isMobileOrTabletUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return MOBILE_OR_TABLET_UA.test(navigator.userAgent);
}

// Track the on-screen keyboard: opening it shrinks the visual viewport, and the
// space between its bottom edge and the layout viewport bottom is the keyboard's
// overlay height. Fires immediately with the current offset, then on every
// visual viewport resize/scroll and window resize. Returns an unsubscribe.
export function trackKeyboardOffset(onChange: (offset: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  const measure = (): void => {
    if (!vv) return;
    onChange(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
  };
  vv?.addEventListener("resize", measure);
  vv?.addEventListener("scroll", measure);
  window.addEventListener("resize", measure);
  measure();
  return () => {
    vv?.removeEventListener("resize", measure);
    vv?.removeEventListener("scroll", measure);
    window.removeEventListener("resize", measure);
  };
}
