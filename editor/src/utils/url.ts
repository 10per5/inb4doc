import { editorSelfBase, staticSiteGeneration } from "@/config";
import { isRootPath, HOME_PATH } from "@/utils/hugo-compat";

export function getCurrentPath(): string {
  if (staticSiteGeneration) {
    return new URLSearchParams(window.location.search).get("path") || HOME_PATH;
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
  } else {
    window.history.pushState(
      { path },
      "",
      `${editorSelfBase}${isRootPath(path) ? "" : path}`,
    );
  }
}

export function replacePath(path: string): void {
  if (staticSiteGeneration) {
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
  if (staticSiteGeneration) {
    return `${norm}?path=${encodeURIComponent(path)}`;
  }
  return norm + path;
}
