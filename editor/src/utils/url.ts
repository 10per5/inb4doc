import { editorSelfBase, staticSiteGeneration } from "@/config";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { isRootPath, HOME_PATH } from "@/utils/hugo-compat";

// Native shells (desktop Saucer app://, Android WebView file://) load the app
// at a fixed shell URL — that URL is never a document path. MountProvider
// covers GuiDesktop; SafProvider covers GuiMobile (which mounts the content via
// SAF and has no MountProvider flag).
const isGui = hasFunc(AppFunc.MountProvider) || hasFunc(AppFunc.SafProvider);

/**
 * Is the document path reflected in the URL (browser / PWA)?
 *
 * Native shells load at a fixed shell URL and their back press arrives through
 * the bridge, so `pushPath`/`replacePath` are no-ops there and the UI-layer
 * history in `services/ui-history-service.ts` must stay out of `history`.
 */
export function usesBrowserHistory(): boolean {
  return typeof history !== "undefined" && !isGui;
}

/**
 * Set when a document opens while a UI layer is frontmost: the document adopts
 * the layer's history entry (`replacePath`) instead of pushing another one.
 * Popping the entry with `history.back()` next to a `pushState` raced the
 * traversal and re-opened the previous document (or the home page), which is
 * why tapping a file on mobile appeared to do nothing.
 */
let adoptNextDocumentPath = false;

export function markDocumentPathAdopted(): void {
  adoptNextDocumentPath = true;
}

export function takeAdoptedDocumentPath(): boolean {
  const adopted = adoptNextDocumentPath;
  adoptNextDocumentPath = false;
  return adopted;
}

export function getCurrentPath(): string {
  if (staticSiteGeneration) {
    return new URLSearchParams(window.location.search).get("path") || HOME_PATH;
  }
  if (isGui) {
    return HOME_PATH;
  }
  const base = editorSelfBase;
  const raw = window.location.pathname;
  let basePath = base;
  if (base.startsWith("http://") || base.startsWith("https://")) {
    basePath = new URL(base).pathname;
  }
  if (basePath && basePath !== "/" && raw.startsWith(basePath)) {
    return raw.slice(basePath.length).replace(/^\//, "").replace(/\/$/, "") || HOME_PATH;
  }
  return raw.replace(/^\//, "").replace(/\/$/, "") || HOME_PATH;
}

export function pushPath(path: string): void {
  if (staticSiteGeneration) {
    const url = new URL(window.location.href);
    if (isRootPath(path)) {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.pushState({ path }, "", url.toString());
  } else if (!isGui) {
    window.history.pushState(
      { path },
      "",
      `${editorSelfBase}${isRootPath(path) ? "" : path}`,
    );
  }
}

/**
 * Called before `replacePath` rewrites the current history entry. The browser
 * UI-layer bookkeeping uses it to release its sentinel entry: replacing it in
 * place means there is nothing left to pop when the layer closes.
 */
let beforePathReplace: (() => void) | null = null

export function setBeforePathReplace(fn: (() => void) | null): void {
  beforePathReplace = fn
}

export function replacePath(path: string): void {
  beforePathReplace?.()
  if (staticSiteGeneration) {
    const url = new URL(window.location.href);
    if (isRootPath(path)) {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.replaceState({ path }, "", url.toString());
  } else if (!isGui) {
    window.history.replaceState(
      { path },
      "",
      `${editorSelfBase}${isRootPath(path) ? "" : path}`,
    );
  }
}

export function buildEditorUrl(base: string, path: string): string {
  if (isRootPath(path) || path === "") {
    return base || "/";
  }
  const norm = base.endsWith("/") ? base : base + "/";
  if (staticSiteGeneration) {
    return `${norm}?path=${encodeURIComponent(path)}`;
  }
  return norm + path;
}
