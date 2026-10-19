/**
 * ToolbarStore — manages toolbar visibility and auto-hide behavior.
 *
 * The toolbar uses CSS `position: sticky` for scroll tracking (compositor-thread).
 * This store only handles the auto-hide class toggle based on scroll direction.
 *
 * The auto-hide class is `toolbar-hidden` (NOT `hidden`) on purpose: the global
 * `.hidden` utility is `display: none !important`, which would rip the sticky bar
 * out of the layout on every toggle. That 28px reflow feeds back into the scroll
 * handler (content height changes → scrollTop settles → spurious scroll event),
 * so the bar flickered/appeared to "regress". `toolbar-hidden` only slides/fades
 * the bar, leaving layout untouched.
 */

export interface ToolbarConfig {
  stickyToolbar: boolean
}

export class ToolbarStore {
  /** Don't auto-hide while scrolled this close to the top. */
  private static readonly HIDE_BELOW = 100

  /**
   * Dead-zone (px) for direction detection. Scroll events jitter by a few px
   * (subpixel, momentum, reflow); without a margin a single stray event flips
   * the bar. Accumulating movement until it crosses the margin keeps the
   * show/hide responsive while ignoring noise.
   */
  private static readonly SCROLL_MARGIN = 8

  /** Class that slides the toolbar out of view (see toolbar.css). */
  private static readonly HIDDEN_CLASS = "toolbar-hidden"

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
      const diff = sy - this.lastScrollY

      // Direction-based: hide on downward scroll past the top band, show on
      // upward scroll. A dead-zone absorbs event jitter so the bar can't flip
      // on a stray few-px scroll; movement accumulates until it crosses the
      // margin. Near the top the bar is always shown.
      if (sy <= ToolbarStore.HIDE_BELOW) {
        this.setHidden(false)
      } else if (diff > ToolbarStore.SCROLL_MARGIN) {
        this.setHidden(true)
      } else if (diff < -ToolbarStore.SCROLL_MARGIN) {
        this.setHidden(false)
      } else {
        return // inside the dead-zone — keep the current state
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
    this.toolbar?.classList.toggle(ToolbarStore.HIDDEN_CLASS, hidden)
  }
}
