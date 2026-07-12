import { editorSelfBase, ssgMode } from "@/config";
import { isRootPath, HOME_PATH } from "@/utils/hugo-compat";

export function getCurrentPath(): string {
  if (ssgMode) {
    return new URLSearchParams(window.location.search).get("path") || HOME_PATH;
  }
  const base = editorSelfBase;
  const raw = window.location.pathname;
  if (base && base !== "/" && raw.startsWith(base)) {
    return raw.slice(base.length).replace(/^\//, "").replace(/\/$/, "") || HOME_PATH;
  }
  return raw.replace(/^\//, "").replace(/\/$/, "") || HOME_PATH;
}

export function pushPath(path: string): void {
  if (ssgMode) {
    const url = new URL(window.location.href);
    if (isRootPath(path)) {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.pushState({ path }, "", url.toString());
  } else {
    window.history.pushState(
      { path },
      "",
      `${editorSelfBase}${isRootPath(path) ? "" : path}`,
    );
  }
}

export function replacePath(path: string): void {
  if (ssgMode) {
    const url = new URL(window.location.href);
    if (isRootPath(path)) {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.replaceState({ path }, "", url.toString());
  } else {
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
  if (ssgMode) {
    return `${norm}?path=${encodeURIComponent(path)}`;
  }
  return norm + path;
}
