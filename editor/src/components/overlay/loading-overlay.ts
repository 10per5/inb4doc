/**
 * LoadingOverlay — the "phantom window" shown on first paint.
 *
 * The initial markup is rendered server-side in `shell.eta` (source:
 * `templates/views/loading-overlay.eta`).  Styles live in
 * `src/styles/loading-overlay.css`.
 *
 * `LoadingOverlay.show()` can re-inject the overlay at runtime (e.g.
 * for a slow re-fetch); `LoadingOverlay.hide()` fades it out once
 * the app is ready.
 */

import { editorSelfBase } from "@/config";
// @ts-ignore — compiled at build time by templates.ts
import renderLoadingOverlay from "@/eta/views/loading-overlay";

const LOADER_ID = "initial-loader";

export function showLoadingOverlay(): void {
  if (document.getElementById(LOADER_ID)) return;

  const el = document.createElement("div");
  el.id = LOADER_ID;
  el.className = "initial-loader";
  el.innerHTML = renderLoadingOverlay({ EDITOR_SELF_BASE: editorSelfBase });
  document.body.appendChild(el);
}

export function hideLoadingOverlay(): void {
  const el = document.getElementById(LOADER_ID);
  if (!el) return;

  el.classList.add("is-hidden");
  const remove = () => el.remove();
  el.addEventListener("transitionend", remove, { once: true });
  setTimeout(remove, 600);
}

export const LoadingOverlay = {
  show: showLoadingOverlay,
  hide: hideLoadingOverlay,
};
