import { appEvents, AppEvent } from "@/stores/app-events";
import { UIService } from "@/stores/ui-store";

export type LayoutPreset = "focused" | "left-panel" | "right-panel" | "two-panel";
export type LayoutWidth = "mobile" | "tablet" | "desktop";

export interface LayoutState {
  nav: boolean;
  meta: boolean;
}

export interface LayoutChangedPayload {
  preset: LayoutPreset;
  width: LayoutWidth;
  nav: boolean;
  meta: boolean;
}

/**
 * LayoutService — owns the View-dropdown panel toggles and the derived layout
 * preset. The two user-facing switches (Navtree, Meta panel) map onto internal
 * presets: nav → LeftPanel, meta → RightPanel, both → TwoPanel, neither →
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
  return { nav: true, meta: width === "desktop" };
}

function resolveWidth(): LayoutWidth {
  const ui = UIService.getInstance();
  if (ui.isMobile()) return "mobile";
  if (ui.isTablet()) return "tablet";
  return "desktop";
}

let instance: LayoutService | null = null;

export class LayoutService {
  private state: LayoutState;

  private constructor() {
    this.state = (g.__inb4docLayoutState ??= bootDefaults(resolveWidth()));
    // Apply the boot preset (focused) immediately so the in-flow columns stay
    // hidden until the user opts in — otherwise the CSS defaults show them at
    // tablet/desktop widths.
    this.apply();
  }

  static getInstance(): LayoutService {
    if (!instance) instance = new LayoutService();
    return instance;
  }

  getState(): LayoutState {
    return { ...this.state };
  }

  getPreset(): LayoutPreset {
    if (this.state.nav && this.state.meta) return "two-panel";
    if (this.state.nav) return "left-panel";
    if (this.state.meta) return "right-panel";
    return "focused";
  }

  isNavOn(): boolean {
    return this.state.nav;
  }

  isMetaOn(): boolean {
    return this.state.meta;
  }

  setNav(on: boolean): void {
    if (this.state.nav === on) return;
    this.state.nav = on;
    this.apply();
  }

  setMeta(on: boolean): void {
    if (this.state.meta === on) return;
    this.state.meta = on;
    this.apply();
  }

  toggleNav(): void {
    this.state.nav = !this.state.nav;
    this.apply();
  }

  toggleMeta(): void {
    this.state.meta = !this.state.meta;
    this.apply();
  }

  private apply(): void {
    const width = resolveWidth();
    // The mobile drawer owns nav visibility below 768px; the classes only
    // affect the in-flow columns at tablet/desktop widths.
    const navVisible = this.state.nav && width !== "mobile";
    const body = document.body.classList;
    body.toggle("layout-nav-off", !navVisible);
    body.toggle("layout-meta-off", !this.state.meta);
    body.toggle("layout-focus", !this.state.nav && !this.state.meta);
    appEvents.emit(AppEvent.LayoutChanged, {
      preset: this.getPreset(),
      width,
      nav: this.state.nav,
      meta: this.state.meta,
    });
  }
}
