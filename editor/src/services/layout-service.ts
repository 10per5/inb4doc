import { appEvents, AppEvent } from "@/stores/app-events";
import { UIService } from "@/stores/ui-store";
import { LayoutPreset, LayoutWidth } from "@/config/enums";
import type { ViewType } from "@/services/view-service";
import { trackKeyboardOffset } from "@/utils/mobile";

export interface LayoutState {
  leftPanel: boolean;
  rightPanel: boolean;
}

export interface LayoutChangedPayload {
  preset: LayoutPreset;
  width: LayoutWidth;
  leftPanel: boolean;
  rightPanel: boolean;
}

/**
 * LayoutService — owns the View-dropdown panel toggles and the derived layout
 * preset. The two user-facing switches (Navtree, Meta panel) map onto internal
 * panels: Navtree → LeftPanel, Meta → RightPanel, both → TwoPanel, neither →
 * Focused. State is cached on globalThis so a hot-swapped topbar chunk (the
 * View menu lives there) keeps the same toggles.
 */
interface LayoutGlobals {
  __inb4docLayoutState?: LayoutState;
}

const g = globalThis as unknown as LayoutGlobals;

function bootDefaults(width: LayoutWidth): LayoutState {
  // Navtree on by default (in-flow column at tablet/desktop; the mobile drawer
  // below 768px is independent of this state). Meta is a right column only on
  // desktop — off elsewhere.
  return { leftPanel: true, rightPanel: width === LayoutWidth.Desktop };
}

let instance: LayoutService | null = null;

export class LayoutService {
  private state: LayoutState;
  private keyboardOffset = 0;
  private stopKeyboardTrack: (() => void) | null = null;

  private constructor() {
    this.state = (g.__inb4docLayoutState ??= bootDefaults(this.currentWidth()));
    // Apply the boot preset (focused) immediately so the in-flow columns stay
    // hidden until the user opts in — otherwise the CSS defaults show them at
    // tablet/desktop widths.
    this.apply();
    // Crossing the tablet/desktop (1200px) boundary via browser zoom or a
    // window resize must behave like a first load of the new bracket, or the
    // body panel classes stay stale (unlike the 768px cutover, which
    // hard-reloads in app.ts). Tablet never keeps the desktop meta-aside
    // choice: resetting to the bracket defaults keeps the nav tree + dock
    // offset (mobile-dock.eta) while still letting the topbar meta toggle
    // place the panel in the tablet left column.
    const widthMq = window.matchMedia("(min-width: 1200px)");
    widthMq.addEventListener("change", () => {
      const defs = bootDefaults(this.currentWidth());
      this.state.leftPanel = defs.leftPanel;
      this.state.rightPanel = defs.rightPanel;
      this.apply();
    });
    // Watch the on-screen keyboard. Opening it on a mobile viewport flips the
    // width to MobileShrink (via apply) and publishes --kb-offset on :root so
    // the shrink CSS can size the layout to the visible area above the keys.
    this.stopKeyboardTrack = trackKeyboardOffset((offset) => {
      const prev = this.currentWidth();
      this.keyboardOffset = offset;
      if (this.currentWidth() !== prev) this.apply();
      document.documentElement.style.setProperty("--kb-offset", `${offset}px`);
    });
  }

  static getInstance(): LayoutService {
    if (!instance) instance = new LayoutService();
    return instance;
  }

  getState(): LayoutState {
    return { ...this.state };
  }

  getPreset(): LayoutPreset {
    if (this.state.leftPanel && this.state.rightPanel) return LayoutPreset.TwoPanel;
    if (this.state.leftPanel) return LayoutPreset.LeftPanel;
    if (this.state.rightPanel) return LayoutPreset.RightPanel;
    return LayoutPreset.Focused;
  }

  getWidth(): LayoutWidth {
    return this.currentWidth();
  }

  /** Whether the given view renders as a center-screen fullview at the current
   * width. Navigation is always a center screen; meta and disk-usage are panels
   * or block containers on tablet/desktop; the rest are mobile-only fullviews.
   * MobileShrink counts as mobile (it is the mobile layout with the keyboard
   * open). */
  isCenterScreen(type: ViewType): boolean {
    if (type === "navigation") return true;
    const width = this.getWidth();
    return width === LayoutWidth.Mobile || width === LayoutWidth.MobileShrink;
  }

  isLeftPanelOn(): boolean {
    return this.state.leftPanel;
  }

  isRightPanelOn(): boolean {
    return this.state.rightPanel;
  }

  setLeftPanel(on: boolean): void {
    if (this.state.leftPanel === on) return;
    if (on && this.currentWidth() === LayoutWidth.Tablet) {
      // Tablet: nav tree and meta panel share the single left gutter, so the
      // two panels are mutually exclusive there.
      this.state.rightPanel = false;
    }
    this.state.leftPanel = on;
    this.apply();
  }

  setRightPanel(on: boolean): void {
    if (this.state.rightPanel === on) return;
    if (on && this.currentWidth() === LayoutWidth.Tablet) {
      this.state.leftPanel = false;
    }
    this.state.rightPanel = on;
    this.apply();
  }

  toggleLeftPanel(): void {
    this.setLeftPanel(!this.state.leftPanel);
  }

  toggleRightPanel(): void {
    this.setRightPanel(!this.state.rightPanel);
  }

  /** Viewport width, keyboard-aware: opening the on-screen keyboard on a mobile
   * viewport resolves to MobileShrink instead of Mobile. */
  private currentWidth(): LayoutWidth {
    const ui = UIService.getInstance();
    if (ui.isMobile()) {
      return this.keyboardOffset > 0
        ? LayoutWidth.MobileShrink
        : LayoutWidth.Mobile;
    }
    if (ui.isTablet()) return LayoutWidth.Tablet;
    return LayoutWidth.Desktop;
  }

  private apply(): void {
    const width = this.currentWidth();
    // The mobile drawer owns nav visibility below 768px; the classes only
    // affect the in-flow columns at tablet/desktop widths.
    const leftVisible =
      this.state.leftPanel &&
      width !== LayoutWidth.Mobile &&
      width !== LayoutWidth.MobileShrink;
    const body = document.body.classList;
    body.toggle("layout-leftpanel-off", !leftVisible);
    body.toggle("layout-rightpanel-off", !this.state.rightPanel);
    body.toggle("layout-focused", !this.state.leftPanel && !this.state.rightPanel);
    body.toggle("layout-mobile-shrink", width === LayoutWidth.MobileShrink);
    appEvents.emit(AppEvent.LayoutChanged, {
      preset: this.getPreset(),
      width,
      leftPanel: this.state.leftPanel,
      rightPanel: this.state.rightPanel,
    });
  }
}
