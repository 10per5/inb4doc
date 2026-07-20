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
  ToolbarMobile = 1 << 3,
  SidebarGestures = 1 << 4,
  MetaPanelCompact = 1 << 5,
  DevOverlay = 1 << 6,
  LivePreview = 1 << 7,
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
    BuildMode.WebLocal | BuildMode.GuiDesktop | BuildMode.GuiMobile,
  [AppFunc.DefaultToRemote]:
    BuildMode.WebLocal | BuildMode.GuiDesktop | BuildMode.GuiMobile,
  [AppFunc.MobileCss]:
    BuildMode.WebLocal | BuildMode.GuiMobile,
  [AppFunc.ToolbarMobile]:
    BuildMode.WebLocal | BuildMode.GuiMobile,
  [AppFunc.SidebarGestures]:
    BuildMode.GuiMobile,
  [AppFunc.MetaPanelCompact]:
    BuildMode.GuiMobile,
  [AppFunc.DevOverlay]:
    BuildMode.GuiDesktop,
  [AppFunc.LivePreview]:
    BuildMode.WebRemote | BuildMode.WebLocal | BuildMode.GuiDesktop,
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

export function modeLabel(mode: BuildMode): string {
  return BUILD_MODE_NAMES[mode];
}
