export enum BuildMode {
  WebRemote = 0b0001,
  WebLocal = 0b0010,
  GuiDesktop = 0b0100,
  GuiMobile = 0b1000,
}

export enum AppFunc {
  AllowProbe = 1 << 0,
  DefaultToRemote = 1 << 1,
  MobileCss = 1 << 2,
  SidebarGestures = 1 << 3,
  MetaPanelCompact = 1 << 4,
  DevOverlay = 1 << 5,
  LivePreview = 1 << 6,
  StaticSiteGeneration = 1 << 7,
  MountProvider = 1 << 8,
  ToolbarQuickNav = 1 << 9,
  FullBundle = 1 << 10,
  DesktopBridge = 1 << 11,
  MobileBridge = 1 << 12,
  ProjectPicker = 1 << 13,
  SafProvider = 1 << 14,
  MobileDock = 1 << 15,
}

export const BUILD_MODE_NAMES: Record<BuildMode, string> = {
  [BuildMode.WebRemote]: "web-remote",
  [BuildMode.WebLocal]: "web-local",
  [BuildMode.GuiDesktop]: "gui-desktop",
  [BuildMode.GuiMobile]: "gui-mobile",
};

export const NAME_TO_BUILD_MODE = Object.fromEntries(
  Object.entries(BUILD_MODE_NAMES).map(([mode, name]) => [name, Number(mode)]),
) as Record<string, BuildMode>;

export const SUPPORTED_MODES: Record<AppFunc, number> = {
  [AppFunc.AllowProbe]:
    BuildMode.WebRemote | BuildMode.WebLocal | BuildMode.GuiDesktop | BuildMode.GuiMobile,
  [AppFunc.DefaultToRemote]:
    BuildMode.WebLocal,
  [AppFunc.MobileCss]:
    BuildMode.WebRemote | BuildMode.WebLocal | BuildMode.GuiMobile,
  [AppFunc.SidebarGestures]:
    BuildMode.GuiMobile,
  [AppFunc.MetaPanelCompact]:
    BuildMode.GuiMobile,
  [AppFunc.DevOverlay]:
    BuildMode.GuiDesktop,
  [AppFunc.LivePreview]:
    BuildMode.WebRemote | BuildMode.WebLocal | BuildMode.GuiDesktop,
  [AppFunc.StaticSiteGeneration]: BuildMode.WebRemote,
  [AppFunc.MountProvider]: BuildMode.GuiDesktop,
  [AppFunc.ToolbarQuickNav]: BuildMode.GuiDesktop,
  // Native-host bridges: desktop Saucer (window.saucer.exposed / inb4docUI)
  // and Android WebView (window.NativeBridge). Web modes have no native host,
  // so neither bridge runs there.
  [AppFunc.DesktopBridge]: BuildMode.GuiDesktop,
  [AppFunc.MobileBridge]: BuildMode.GuiMobile,
  // Runtime directory reselection (File → Open Project… + Recent Projects):
  // desktop via the native folder dialog + app:// scheme, mobile via SAF.
  [AppFunc.ProjectPicker]: BuildMode.GuiDesktop | BuildMode.GuiMobile,
  // SAF (Storage Access Framework) content provider over the Android bridge.
  [AppFunc.SafProvider]: BuildMode.GuiMobile,
  // Mobile bottom dock + context-aware editing toolbar. Native mobile host is
  // the primary target. WebLocal ships the dock markup/CSS for the local
  // dev/test mode, but the runtime hasFunc() gate turns it on only for a mobile
  // viewport/UA (see hasFunc) — desktop stays desktop by default. WebRemote
  // (the live site) and GuiDesktop stay desktop.
  [AppFunc.MobileDock]: BuildMode.GuiMobile | BuildMode.WebLocal,
  // Build-time-only packaging flag: ship the complete local bundle (no thin
  // shell, empty UPDATE_BASE) so the build never fetches remotely. Default-on
  // for web-local (`bun dev` serves a full self-contained bundle and updates
  // from itself), web-remote (the SW serves the whole public/) and gui-desktop
  // (self-contained read-only install — the Dockerfile/editor_root payload).
  // A thin shell is just the absence of FullBundle (GuiMobile only): it ships
  // the core boot set + updater and downloads the editor on first run, so the
  // lazy-load mechanism keys off !FullBundle — one flag, one build decision.
  // FULL_BUNDLE=1 is gone — this mask is the only switch.
  [AppFunc.FullBundle]: BuildMode.WebLocal | BuildMode.WebRemote | BuildMode.GuiDesktop,
};

let _currentMode: BuildMode | null = null;

function getCurrentMode(): BuildMode {
  if (_currentMode === null) {
    const raw = document.documentElement.dataset.buildMode;
    _currentMode = NAME_TO_BUILD_MODE[raw || ""] ?? BuildMode.WebLocal;
  }
  return _currentMode;
}

export function currentBuildMode(): BuildMode {
  return getCurrentMode();
}

const MOBILE_VIEWPORT_MQ = "(max-width: 767px)";

// Web-local is the local dev/test mode, not a mobile target: the dock layout
// engages only on a mobile viewport OR a mobile UA (phone in landscape), so
// desktop browsers keep the desktop chrome by default. Must mirror the inline
// pre-paint script in shell.eta (mobile-layout/desktop-layout classes).
export function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (window.matchMedia(MOBILE_VIEWPORT_MQ).matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
}

// A thin shell is simply the absence of FullBundle (GuiMobile only).
export function hasFunc(func: AppFunc): boolean {
  const mode = getCurrentMode();
  // Web-local responsive-web (Part F): the dock layout is UA/viewport-gated,
  // not enabled by default — desktop stays desktop, mobile gets the dock.
  if (func === AppFunc.MobileDock && mode === BuildMode.WebLocal) {
    return isMobileViewport();
  }
  return !!(SUPPORTED_MODES[func] & mode)
}

// Updater transport selection (Part C). The updater core
// (templates/partials/updater-core.eta, compiled to src/eta/updater-core.ts) is
// transport-agnostic — only the glue layers differ per deployment:
//
//   WebRemote / WebLocal → ServiceWorker: sw.js precaches via updaterTransfer
//     (Cache Storage backend) and posts the manifest; the page's sw-registrar
//     applies via updaterDiff + ModuleRegistry.swap. Selected implicitly by the
//     protocol check in sw-registrar (http/https only).
//
//   GuiDesktop → fetch manifest from UPDATE_BASE + disk cache + NativeBridge
//     reload (Part E). No ServiceWorker (app:// protocol).
//
//   GuiMobile  → fetch manifest from UPDATE_BASE + WebView
//     shouldInterceptRequest cache + reload (Part E). No ServiceWorker.
export enum UpdaterTransport {
  ServiceWorker = 1,
  FetchAndCache = 2,
}

export function updaterTransportFor(mode: BuildMode): UpdaterTransport {
  switch (mode) {
    case BuildMode.WebRemote:
    case BuildMode.WebLocal:
      return UpdaterTransport.ServiceWorker;
    case BuildMode.GuiDesktop:
    case BuildMode.GuiMobile:
      return UpdaterTransport.FetchAndCache;
  }
}

export function modeLabel(mode: BuildMode): string {
  return BUILD_MODE_NAMES[mode];
}
