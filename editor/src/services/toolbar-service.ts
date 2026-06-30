/**
 * ToolbarService
 *
 * Manages toolbar visibility and auto-hide behavior based on scroll position
 * Handles sticky toolbar preferences and scroll event listeners
 */

import type { TopbarAPI } from "../components/toolbar/topbar";

export interface ToolbarConfig {
  stickyToolbar: boolean;
}

export class ToolbarService {
  private toolbar: HTMLElement | null;
  private editorEl: HTMLElement | null;
  private lastScrollY: number = 0;
  private autoHidePref: boolean;
  private onScroll: (() => void) | null = null;
  private showOnFocus: (() => void) | null = null;

  constructor(config: ToolbarConfig) {
    this.toolbar = document.getElementById("app-toolbar");
    this.editorEl = document.getElementById("milkdown-editor");
    this.autoHidePref = config.stickyToolbar;
  }

  /**
   * Initialize toolbar scroll listeners
   */
  public initialize(): void {
    if (!this.toolbar) return;

    this.onScroll = this.createScrollHandler();
    this.showOnFocus = this.createFocusHandler();

    const layoutEl = document.querySelector(".book-layout");

    // Attach scroll listeners to both possible scroll containers
    layoutEl?.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });

    // Show toolbar on editor focus/click
    this.editorEl?.addEventListener("focusin", this.showOnFocus);
    this.editorEl?.addEventListener("click", this.showOnFocus);
  }

  /**
   * Update sticky toolbar preference
   */
  public setStickyPreference(sticky: boolean): void {
    this.autoHidePref = sticky;

    if (!sticky) {
      // Show toolbar immediately and reset styles
      this.toolbar?.classList.remove("hidden");
      this.toolbar?.removeAttribute("style");
    }
  }

  /**
   * Destroy listeners
   */
  public destroy(): void {
    if (!this.onScroll || !this.showOnFocus) return;

    const layoutEl = document.querySelector(".book-layout");
    layoutEl?.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("scroll", this.onScroll);

    this.editorEl?.removeEventListener("focusin", this.showOnFocus);
    this.editorEl?.removeEventListener("click", this.showOnFocus);
  }

  /**
   * Create scroll handler that hides/shows toolbar
   */
  private createScrollHandler(): () => void {
    return () => {
      if (!this.autoHidePref || !this.toolbar) return;

      const layoutEl = document.querySelector(".book-layout");
      const sy = layoutEl?.scrollTop ?? window.scrollY;

      if (sy > 100 && sy > this.lastScrollY) {
        // Scrolling down and past threshold: hide toolbar
        this.toolbar.style.top = sy + "px";
        this.toolbar.classList.add("hidden");
      } else if (sy < this.lastScrollY) {
        // Scrolling up: show toolbar
        this.toolbar.style.top = sy + "px";
        this.toolbar.classList.remove("hidden");
      }

      this.lastScrollY = sy;
    };
  }

  /**
   * Create focus handler that shows toolbar
   */
  private createFocusHandler(): () => void {
    return () => {
      if (!this.toolbar) return;

      const layoutEl = document.querySelector(".book-layout");
      const sy = layoutEl?.scrollTop ?? window.scrollY;

      this.toolbar.style.top = sy + "px";
      this.toolbar.classList.remove("hidden");
    };
  }
}
