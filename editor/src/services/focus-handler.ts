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

export function save(): void {
  if (!previousFocus) {
    previousFocus = document.activeElement as HTMLElement | null;
  }
}

export function restore(): void {
  const el = previousFocus;
  previousFocus = null;
  if (el && el.isConnected) {
    el.focus();
  } else if (defaultFocus) {
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
