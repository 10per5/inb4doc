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

// Below this the "shrink" is browser chrome, not a keyboard: `visualViewport`
// is regularly a few px shy of `innerHeight` (horizontal scrollbar ~15px,
// fractional device-pixel rounding < 1px), so `innerHeight - vv.height` is a
// small positive number even with no on-screen keyboard at all. A real OSK is
// hundreds of px; anything this small means the viewport never shrank. Using
// `> 0` as the "keyboard is up" test made every eligible device (phone/tablet
// viewport, tablet UA) sit in keyboard mode forever — the follow-only toolbar.
const KEYBOARD_MIN_OFFSET = 80;

// Track the on-screen keyboard and report its overlay height. Anything below
// KEYBOARD_MIN_OFFSET reports as 0 (see above). Fires immediately with the
// current offset, then on every visual viewport resize/scroll and window
// resize. Returns an unsubscribe.
//
// Two engines, two models — both must be measured:
//   iOS/WebKit shrinks the VISUAL viewport and leaves the layout one alone,
//     so `innerHeight - (vv.offsetTop + vv.height)` is the keyboard height.
//   Android (adjustResize) shrinks the LAYOUT viewport instead: `innerHeight`
//     and `vv.height` drop together and that inset stays 0. Reading only the
//     inset reported "keyboard closed" on every Android phone, so the toolbar
//     could never leave pinned mode no matter what the preference said.
// The Android signal is therefore the drop from the tallest layout height seen.
export function trackKeyboardOffset(onChange: (offset: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  let baselineHeight = window.innerHeight;
  let lastWidth = window.innerWidth;
  const measure = (): void => {
    // A width change is a rotation / window resize, not a keyboard: without the
    // reset landscape's shorter height would read as a keyboard forever.
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      baselineHeight = window.innerHeight;
    }
    const layoutDrop = baselineHeight - window.innerHeight;
    baselineHeight = Math.max(baselineHeight, window.innerHeight);
    const visualInset = vv
      ? Math.round(window.innerHeight - (vv.offsetTop + vv.height))
      : 0;
    const inset = Math.max(layoutDrop, visualInset);
    onChange(inset < KEYBOARD_MIN_OFFSET ? 0 : inset);
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
