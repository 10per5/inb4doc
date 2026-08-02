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
  /**
   * Dead-zone margin for visibility flips. Scroll position can jitter by
   * several px around the scroll anchor while content height settles (e.g.
   * after a source-mode apply/cancel re-render); without this margin the
   * `hidden` class flips on every reversal and the 0.46s opacity transition
   * reads as visible flicker. Keep it larger than the observed jitter.
   */
  private static readonly MARGIN = 64

  private toolbar: HTMLElement | null
  private editorEl: HTMLElement | null
  private hidden = false
  private flipScrollY = 0
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

      if (this.hidden) {
        if (sy <= this.flipScrollY - ToolbarStore.MARGIN) {
          this.setHidden(false)
        }
      } else if (sy > ToolbarStore.HIDE_BELOW && sy >= this.flipScrollY + ToolbarStore.MARGIN) {
        this.setHidden(true)
      }
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
    this.flipScrollY = layoutEl?.scrollTop ?? 0
    this.toolbar?.classList.toggle("hidden", hidden)
  }
}
