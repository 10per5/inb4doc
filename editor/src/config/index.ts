import { hasFunc, AppFunc } from "$/build/build-mode";

export const editorSelfBase: string =
  (document.querySelector('meta[name="editor-self-base"]')?.getAttribute("content") ?? ".").replace(/\/?$/, "/");

export const liveUrlBase: string =
  document.querySelector('meta[name="live-url-base"]')?.getAttribute("content") ?? "";

export const isDev: boolean =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const staticSiteGeneration: boolean = hasFunc(AppFunc.StaticSiteGeneration);

export const appVersion: string =
  document.querySelector('meta[name="app-version"]')?.getAttribute("content") ?? "";

// The remote base the fetch updater transports pull from (thin-shell GuiDesktop).
// Set at build time via UPDATE_BASE; empty means no fetch updater.
export const updateBase: string =
  document.querySelector('meta[name="update-base"]')?.getAttribute("content") ?? "";

// The hashes of the build this page was loaded with. The SW sends the incoming
// build's hashes on activation; any difference means the entry pot (appHash) or
// the shell (indexHash) changed since boot, which a hot swap can never apply —
// that forces a reload.
export const bootedAppHash: string =
  document.querySelector('meta[name="app-hash"]')?.getAttribute("content") ?? "";

export const bootedIndexHash: string =
  document.querySelector('meta[name="index-hash"]')?.getAttribute("content") ?? "";

// The build generation (buildVersion) this page's index.html was rendered with,
// written alongside the hashes so the marker and the hashes always describe the
// same build. An incoming activation whose marker equals this one is the same
// generation — any app/index hash difference is rebuild churn, not a real entry
// change — so the entry/shell reload can be skipped for it.
export const bootedBuildVersion: string =
  document.querySelector('meta[name="build-version"]')?.getAttribute("content") ?? "";
