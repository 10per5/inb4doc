/**
 * ToolbarStore — manages toolbar visibility and auto-hide behavior.
 *
 * Stores scroll position and sticky preference. Handles scroll/focus
 * event listeners for auto-hide functionality.
 */

export interface ToolbarConfig {
  stickyToolbar: boolean
}

export class ToolbarStore {
  private toolbar: HTMLElement | null
  private editorEl: HTMLElement | null
  private lastScrollY: number = 0
  private autoHidePref: boolean
  private onScroll: (() => void) | null = null
  private showOnFocus: (() => void) | null = null

  constructor(config: ToolbarConfig) {
    this.toolbar = document.getElementById("app-toolbar")
    this.editorEl = document.getElementById("milkdown-editor")
    this.autoHidePref = config.stickyToolbar
  }

  initialize(): void {
    if (!this.toolbar) return

    this.onScroll = this.createScrollHandler()
    this.showOnFocus = this.createFocusHandler()

    const layoutEl = document.querySelector(".book-layout")

    layoutEl?.addEventListener("scroll", this.onScroll, { passive: true })
    window.addEventListener("scroll", this.onScroll, { passive: true })

    this.editorEl?.addEventListener("focusin", this.showOnFocus)
    this.editorEl?.addEventListener("click", this.showOnFocus)
  }

  setStickyPreference(sticky: boolean): void {
    this.autoHidePref = sticky

    if (!sticky) {
      this.toolbar?.classList.remove("hidden")
      this.toolbar?.removeAttribute("style")
    }
  }

  destroy(): void {
    if (!this.onScroll || !this.showOnFocus) return

    const layoutEl = document.querySelector(".book-layout")
    layoutEl?.removeEventListener("scroll", this.onScroll)
    window.removeEventListener("scroll", this.onScroll)

    this.editorEl?.removeEventListener("focusin", this.showOnFocus)
    this.editorEl?.removeEventListener("click", this.showOnFocus)
  }

  private createScrollHandler(): () => void {
    return () => {
      if (!this.autoHidePref || !this.toolbar) return

      const layoutEl = document.querySelector(".book-layout")
      const sy = layoutEl?.scrollTop ?? window.scrollY

      if (sy > 100 && sy > this.lastScrollY) {
        this.toolbar.style.top = sy + "px"
        this.toolbar.classList.add("hidden")
      } else if (sy < this.lastScrollY) {
        this.toolbar.style.top = sy + "px"
        this.toolbar.classList.remove("hidden")
      }

      this.lastScrollY = sy
    }
  }

  private createFocusHandler(): () => void {
    return () => {
      if (!this.toolbar) return

      const layoutEl = document.querySelector(".book-layout")
      const sy = layoutEl?.scrollTop ?? window.scrollY

      this.toolbar.style.top = sy + "px"
      this.toolbar.classList.remove("hidden")
    }
  }
}
