/**
 * UIService - Global Singleton
 * 
 * Manages UI state and responsive behavior globally
 * Handles viewport detection and panel visibility state
 * Available to any part of the application
 */

export interface UIServiceConfig {
  onMediaChange?: () => void;
}

let globalUIService: UIService | null = null;

export class UIService {
  private sidebarOpen: boolean = false;
  private mediaQuery: MediaQueryList;
  private config: UIServiceConfig;
  private mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

  constructor(config: UIServiceConfig = {}) {
    this.config = config;
    this.mediaQuery = window.matchMedia("(min-width: 768px)");
  }

  /**
   * Get or create global UIService singleton
   */
  static getInstance(): UIService {
    if (!globalUIService) {
      globalUIService = new UIService();
      globalUIService.initialize();
    }
    return globalUIService;
  }

  /**
   * Initialize the service
   */
  initialize(): void {
    this.setupMediaListeners();
    this.setupDOM();
  }

  /**
   * Cleanup the service
   */
  destroy(): void {
    if (this.mediaQueryListener) {
      this.mediaQuery.removeEventListener("change", this.mediaQueryListener);
    }
  }

  /**
   * Check if viewport is mobile (<768px)
   */
  isMobile(): boolean {
    return window.innerWidth < 768;
  }

  /**
   * Check if viewport is tablet (768px-1199px)
   */
  isTablet(): boolean {
    return window.innerWidth >= 768 && window.innerWidth < 1200;
  }

  /**
   * Check if viewport is desktop (>=1200px)
   */
  isDesktop(): boolean {
    return window.innerWidth >= 1200;
  }

  /**
   * Get sidebar open state
   */
  isSidebarOpen(): boolean {
    return this.sidebarOpen;
  }

  /**
   * Set sidebar open state
   */
  setSidebarOpen(open: boolean): void {
    this.sidebarOpen = open;
    const sidebarEl = document.querySelector(".book-menu");
    const backdrop = document.querySelector(".book-menu-backdrop");
    if (open) {
      sidebarEl?.classList.add("sidebar-open");
      backdrop?.classList.add("visible");
    } else {
      sidebarEl?.classList.remove("sidebar-open");
      backdrop?.classList.remove("visible");
    }
  }

  /**
   * Toggle sidebar (with optional explicit state)
   */
  toggleSidebar(open?: boolean): void {
    const shouldOpen = open ?? !this.isSidebarOpen();
    this.setSidebarOpen(shouldOpen);
  }

  /**
   * Setup DOM elements (backdrops)
   */
  private setupDOM(): void {
    // Create sidebar backdrop if it doesn't exist
    if (!document.querySelector(".book-menu-backdrop")) {
      const sidebarBackdrop = document.createElement("div");
      sidebarBackdrop.className = "book-menu-backdrop";
      sidebarBackdrop.addEventListener("click", () => this.toggleSidebar(false));
      document.body.appendChild(sidebarBackdrop);
    }
  }

  /**
   * Listen to media query changes
   */
  private setupMediaListeners(): void {
    this.mediaQueryListener = () => this.handleMediaChange();
    this.mediaQuery.addEventListener("change", this.mediaQueryListener);
  }

  /**
   * Handle media query change
   */
  private handleMediaChange(): void {
    // Close sidebars when switching to desktop
    if (this.mediaQuery.matches) {
      this.setSidebarOpen(false);
    }
    this.config.onMediaChange?.();
  }
}

