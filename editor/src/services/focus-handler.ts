/**
 * FocusHandler — tracks and restores focus across UI transitions.
 *
 * Usage:
 *   import * as focusHandler from "@/services/focus-handler";
 *   focusHandler.save();
 *   // ... do something that changes focus ...
 *   focusHandler.restore();
 */

let previousFocus: HTMLElement | null = null;
let defaultFocus: (() => void) | null = null;

const TOOLBAR_SELECTOR = ".app-toolbar";

function isToolbarElement(el: Element | null): boolean {
  return !!el?.closest?.(TOOLBAR_SELECTOR);
}

export function save(): void {
  const active = document.activeElement as HTMLElement | null;
  // Ignore non-focusable roots (BODY/HTML) and keep the original target
  // while focus already lives inside the toolbar.
  if (!active || active === document.body || active === document.documentElement) {
    return;
  }
  if (isToolbarElement(active)) {
    return;
  }
  previousFocus = active;
}

export function restore(): void {
  const el = previousFocus;
  previousFocus = null;
  if (el && el.isConnected) {
    el.focus();
    if (document.activeElement === el) return;
  }
  if (defaultFocus) {
    defaultFocus();
  }
}

export function setDefaultFocus(fn: () => void): void {
  defaultFocus = fn;
}

export function clear(): void {
  previousFocus = null;
}

export function hasSaved(): boolean {
  return previousFocus !== null;
}
