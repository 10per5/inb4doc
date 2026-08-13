import { hasFunc, AppFunc, BuildMode, currentBuildMode } from "$/build/build-mode";

const MOBILE_VIEWPORT_MQ = "(max-width: 767px)";

// The web chrome is chosen by viewport WIDTH, not by UA: a tablet in landscape
// (e.g. iPad at 1210px) gets the desktop toolbar even though its UA says
// "Mobile". The rest of the layout can stay mobile-like via the Focused default.
// Must mirror the inline pre-paint script in shell.eta
// (mobile-layout/desktop-layout classes).
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_VIEWPORT_MQ).matches;
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

// Visual-viewport metrics captured when the on-screen keyboard changes.
export interface KeyboardOffset {
  // Space between the keyboard's top edge and the layout viewport bottom. 0
  // when no keyboard is shown (or it fits entirely within the viewport).
  offset: number;
  // The visual viewport's top edge in layout-viewport coordinates — the pan
  // the browser applies to keep the focused field visible above the keyboard.
  offsetTop: number;
  // The visual viewport's current height (the area not covered by the keyboard
  // / browser chrome).
  height: number;
}

// Track the on-screen keyboard: opening it shrinks the visual viewport, and the
// space between its bottom edge and the layout viewport bottom is the keyboard's
// overlay height. Fires immediately with the current metrics, then on every
// visual viewport resize/scroll and window resize. Returns an unsubscribe.
export function trackKeyboardOffset(onChange: (k: KeyboardOffset) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  const measure = (): void => {
    if (!vv) return;
    onChange({
      offset: Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)),
      offsetTop: vv.offsetTop,
      height: vv.height,
    });
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
