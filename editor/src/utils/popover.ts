// Shared popover flip logic: measure a hidden panel, then toggle the
// toolbar-menu--up / toolbar-menu--right classes so it stays on screen.
// Extracted from Menu.positionPanel() so the dock quick-actions menu, the
// block-handle menu, and the mobile edit-toolbar popover share one
// implementation. The classes are defined in src/styles/ui/menu.css.

export type FlipAnchorRect = Pick<DOMRect, "left" | "top" | "bottom" | "right">

export interface PanelFlipOptions {
  // Anchor point in viewport coordinates.
  anchor: FlipAnchorRect
  // Above-first (block anchors). Default false = today's below-first, flip up
  // on overflow.
  preferAbove?: boolean
  vw?: number
  vh?: number
  margin?: number
}

// Measure the panel while visually hidden (no reposition flash), then flip:
// - Vertical: opens below at its natural `top:100%`; `--up` moves it above.
//   `spaceAbove`/`spaceBelow` are the free room on each side of the anchor.
// - Horizontal: `--right` when the natural `left:0` would overflow the right
//   edge of the viewport.
export function applyPanelFlip(panel: HTMLElement, opts: PanelFlipOptions): void {
  const vw = opts.vw ?? document.documentElement.clientWidth
  const vh = opts.vh ?? window.visualViewport?.height ?? document.documentElement.clientHeight
  const margin = opts.margin ?? 12
  const { anchor } = opts

  const prevDisplay = panel.style.display
  panel.style.display = "block"
  panel.style.visibility = "hidden"
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  panel.style.visibility = ""
  panel.style.display = prevDisplay

  panel.classList.remove("toolbar-menu--right", "toolbar-menu--up")
  if (anchor.left + width > vw - 8) {
    panel.classList.add("toolbar-menu--right")
  }

  const spaceBelow = vh - (anchor.bottom + margin)
  const spaceAbove = anchor.top - margin
  const fitsBelow = spaceBelow >= height
  const fitsAbove = spaceAbove >= height
  let up: boolean
  if (opts.preferAbove) {
    up = fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow)
  } else {
    up = !fitsBelow
  }
  if (up) {
    panel.classList.add("toolbar-menu--up")
  }
}
