import { editorSelfBase, ssgMode } from "../config";

export function getCurrentPath(): string {
  if (ssgMode) {
    return new URLSearchParams(window.location.search).get("path") || "_index";
  }
  const base = editorSelfBase;
  const raw = window.location.pathname;
  if (base && base !== "/" && raw.startsWith(base)) {
    return raw.slice(base.length).replace(/^\//, "").replace(/\/$/, "") || "_index";
  }
  return raw.replace(/^\//, "").replace(/\/$/, "") || "_index";
}

export function pushPath(path: string): void {
  if (ssgMode) {
    const url = new URL(window.location.href);
    if (path === "_index") {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.pushState({ path }, "", url.toString());
  } else {
    window.history.pushState(
      { path },
      "",
      `${editorSelfBase}${path === "_index" ? "" : path}`,
    );
  }
}

export function replacePath(path: string): void {
  if (ssgMode) {
    const url = new URL(window.location.href);
    if (path === "_index") {
      url.searchParams.delete("path");
    } else {
      url.searchParams.set("path", path);
    }
    window.history.replaceState({ path }, "", url.toString());
  } else {
    window.history.replaceState(
      { path },
      "",
      `${editorSelfBase}${path === "_index" ? "" : path}`,
    );
  }
}

export function buildEditorUrl(base: string, path: string): string {
  if (path === "_index" || path === "") {
    return base || "/";
  }
  const norm = base.endsWith("/") ? base : base + "/";
  if (ssgMode) {
    return `${norm}?path=${encodeURIComponent(path)}`;
  }
  return norm + path;
}
