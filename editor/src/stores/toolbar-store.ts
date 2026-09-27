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
  /** Don't auto-hide while scrolled this close to the top. */
  private static readonly HIDE_BELOW = 100

  private toolbar: HTMLElement | null
  private editorEl: HTMLElement | null
  private hidden = false
  private lastScrollY = 0
  private autoHidePref: boolean
  private onScroll: (() => void) | null = null
  private showOnFocus: (() => void) | null = null

  constructor(config: ToolbarConfig) {
    this.toolbar = document.getElementById("app-toolbar")
    this.editorEl = document.getElementById("inb4doc-editor")
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
      this.setHidden(false)
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

      // Direction-based: hide only after scrolling down past the top band, and
      // show again on ANY upward scroll. The old threshold required scrolling
      // up by a fixed margin from the hide point, which was unreachable on
      // short documents (or near the bottom) — so the bar could never re-show.
      if (sy > ToolbarStore.HIDE_BELOW && sy > this.lastScrollY) {
        this.setHidden(true)
      } else if (sy < this.lastScrollY) {
        this.setHidden(false)
      }
      this.lastScrollY = sy
    }
  }

  private createFocusHandler(): () => void {
    return () => {
      if (this.autoHidePref) {
        this.setHidden(false)
      }
    }
  }

  private setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return

    this.hidden = hidden
    const layoutEl = document.querySelector(".book-layout")
    this.lastScrollY = layoutEl?.scrollTop ?? 0
    this.toolbar?.classList.toggle("hidden", hidden)
  }
}
