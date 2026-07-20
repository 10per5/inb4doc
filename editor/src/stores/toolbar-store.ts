/**
 * ToolbarStore — manages toolbar visibility and auto-hide behavior.
 *
 * The toolbar uses CSS `position: sticky` for scroll tracking (compositor-thread).
 * This store only handles the auto-hide class toggle based on scroll direction.
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
    this.autoHidePref = !config.stickyToolbar
  }

  initialize(): void {
    if (!this.toolbar) return

    this.onScroll = this.createScrollHandler()
    this.showOnFocus = this.createFocusHandler()

    const layoutEl = document.querySelector(".book-layout")
    layoutEl?.addEventListener("scroll", this.onScroll, { passive: true })

    this.editorEl?.addEventListener("focusin", this.showOnFocus)
    this.editorEl?.addEventListener("click", this.showOnFocus)
  }

  setStickyPreference(sticky: boolean): void {
    this.autoHidePref = !sticky

    if (sticky) {
      this.toolbar?.classList.remove("hidden")
    }
  }

  destroy(): void {
    if (!this.onScroll || !this.showOnFocus) return

    const layoutEl = document.querySelector(".book-layout")
    layoutEl?.removeEventListener("scroll", this.onScroll)

    this.editorEl?.removeEventListener("focusin", this.showOnFocus)
    this.editorEl?.removeEventListener("click", this.showOnFocus)
  }

  private createScrollHandler(): () => void {
    return () => {
      if (!this.toolbar || !this.autoHidePref) return

      const layoutEl = document.querySelector(".book-layout")
      const sy = layoutEl?.scrollTop ?? 0

      if (sy > 100 && sy > this.lastScrollY) {
        this.toolbar.classList.add("hidden")
      } else if (sy < this.lastScrollY) {
        this.toolbar.classList.remove("hidden")
      }

      this.lastScrollY = sy
    }
  }

  private createFocusHandler(): () => void {
    return () => {
      if (!this.toolbar) return

      if (this.autoHidePref) {
        this.toolbar.classList.remove("hidden")
      }
    }
  }
}
