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
  ThinShell = 1 << 10,
  DesktopBridge = 1 << 11,
  MobileBridge = 1 << 12,
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
  // Thin-shell packaging (Part C.1): the GuiDesktop/GuiMobile install ships only
  // the core boot set + updater (index.html, app.js, sw/manifest, css); the
  // first run downloads the live editor into the writable data dir. This flag
  // ALSO drives the two-stage entry + lazy Milkdown (Part D): a thin shell ships
  // the eager core chunks only, so the lazy-load mechanism keys off ThinShell —
  // one flag, one build decision. Web modes always ship the full public/ (the
  // SW serves it).
  [AppFunc.ThinShell]: BuildMode.GuiDesktop | BuildMode.GuiMobile,
  // Native-host bridges: desktop Saucer (window.saucer.exposed / inb4docUI)
  // and Android WebView (window.NativeBridge). Web modes have no native host,
  // so neither bridge runs there.
  [AppFunc.DesktopBridge]: BuildMode.GuiDesktop,
  [AppFunc.MobileBridge]: BuildMode.GuiMobile,
};

let _currentMode: BuildMode | null = null;

function getCurrentMode(): BuildMode {
  if (_currentMode === null) {
    const raw = document.documentElement.dataset.buildMode;
    _currentMode = NAME_TO_BUILD_MODE[raw || ""] ?? BuildMode.WebLocal;
  }
  return _currentMode;
}

export function hasFunc(func: AppFunc): boolean {
  return !!(SUPPORTED_MODES[func] & getCurrentMode());
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
