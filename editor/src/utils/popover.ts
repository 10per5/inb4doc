// Shared popover flip logic: measure a hidden panel, then toggle the
// toolbar-menu--up / toolbar-menu--right classes (and clamp horizontally) so
// it stays on screen. Extracted from Menu.positionPanel() so the dock
// quick-actions menu, the block-handle menu, and the mobile edit-toolbar
// popover share one implementation. The classes are defined in
// src/styles/ui/menu.css.

import type { EditorView } from "prosemirror-view"

export type FlipAnchorRect = Pick<DOMRect, "left" | "top" | "bottom" | "right">

export interface PanelFlipOptions {
  // Anchor point in viewport coordinates.
  anchor: FlipAnchorRect
  // Above-first (block anchors). Default false = below-first, flip up on
  // overflow.
  preferAbove?: boolean
  // Cursor/caret rect, used when neither side of the anchor fits the viewport
  // (the anchored block is taller than the screen): the popover opens relative
  // to the cursor instead, on the side with the most visible space — below
  // when the cursor is in the upper half, above when it's in the lower half.
  anchorCursor?: FlipAnchorRect
  // Horizontal flipping/clamping. Set false when the panel owns its horizontal
  // alignment via its own CSS (panelClass panels in their dock position).
  flipX?: boolean
  // Move the panel's 0×0 container so the class placement lands on the anchor
  // rect: below → container at (anchor.left, anchor.bottom + margin), above →
  // (anchor.left, anchor.top). Set true when the panel lives inside a
  // caller-positioned zero-size anchor (block-anchored menus, the edit-toolbar
  // popover); leave false when the container itself spans the anchor rect.
  positionAnchor?: boolean
  // CSS display to measure the panel with while it's hidden. Default "block"
  // suits the .toolbar-menu panels; flex-layout popovers (the edit-toolbar)
  // must pass "flex" or the measured width collapses to the widest child.
  measureDisplay?: string
  vw?: number
  vh?: number
  margin?: number
}

// Measure the panel while visually hidden (no reposition flash), then flip:
// - Vertical: `--up` opens above the anchor, the natural `top:100%` below.
//   `spaceAbove`/`spaceBelow` are the free room on each side of the anchor.
//   Below-first by default (flip up on overflow); `preferAbove` flips the
//   preference. When neither side fits (the block is taller than the viewport)
//   and `anchorCursor` is given, placement switches to the cursor so the panel
//   stays on screen (near the bottom → above, near the top → below).
// - Horizontal: `--right` when the natural `left:0` would overflow the right
//   edge AND right-aligning to the anchor keeps it on screen; then clamp so
//   the panel never leaves the viewport. With `positionAnchor` the clamp lands
//   on the container's inline left/top; otherwise a clamped inline left offset
//   shifts the panel within its mount.
export function applyPanelFlip(panel: HTMLElement, opts: PanelFlipOptions): void {
  const vw = opts.vw ?? document.documentElement.clientWidth
  const vh = opts.vh ?? window.visualViewport?.height ?? document.documentElement.clientHeight
  const margin = opts.margin ?? 12
  const flipX = opts.flipX ?? true
  const { anchor } = opts

  const prevDisplay = panel.style.display
  panel.style.display = opts.measureDisplay ?? "block"
  panel.style.visibility = "hidden"
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  panel.style.visibility = ""
  panel.style.display = prevDisplay

  panel.classList.remove("toolbar-menu--right", "toolbar-menu--up")
  panel.style.left = ""
  panel.style.top = ""
  panel.style.bottom = ""

  // Horizontal: right-align to the anchor when the natural left edge would
  // overflow the right edge AND right-aligning keeps the panel on screen;
  // otherwise stay left-anchored and let the clamp below snap it to an edge.
  const leftAnchored =
    !flipX || !(anchor.left + width > vw - 8 && anchor.right - width >= 0)
  if (!leftAnchored) {
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
  // Neither side of the anchor has room (the block is taller than the
  // viewport): open relative to the cursor instead, on the side with the most
  // visible space around it — near the bottom → above, near the top → below.
  let verticalAnchor = anchor
  if (!fitsBelow && !fitsAbove && opts.anchorCursor) {
    const cursorMid = (opts.anchorCursor.top + opts.anchorCursor.bottom) / 2
    up = cursorMid >= vh / 2
    verticalAnchor = opts.anchorCursor
  }
  if (up) {
    panel.classList.add("toolbar-menu--up")
  }

  if (opts.positionAnchor) {
    // The panel is absolute inside a caller-positioned 0×0 point; move that
    // point so the class placement lands where the panel should go: no --up →
    // panel top at container top = anchor.bottom + margin; --up → panel bottom
    // at anchor.top - margin (calc(100% + 12px) of a 0-height container).
    // Horizontal stays block-anchored (left side); vertical uses the cursor in
    // the taller-than-viewport case so the panel stays on screen.
    const container = panel.parentElement
    if (container) {
      const maxLeft = Math.max(0, vw - width)
      const containerLeft = leftAnchored
        ? Math.min(Math.max(anchor.left, 0), maxLeft)
        : Math.min(Math.max(anchor.right, width), vw)
      container.style.left = `${containerLeft}px`
      container.style.top = up ? `${verticalAnchor.top}px` : `${verticalAnchor.bottom + margin}px`
    }
  } else if (flipX) {
    const desired = leftAnchored ? anchor.left : anchor.right - width
    const maxLeft = Math.max(0, vw - width)
    const clamped = Math.min(Math.max(desired, 0), maxLeft)
    if (clamped !== desired) {
      panel.style.left = `${clamped - anchor.left}px`
    }
  }
}

// Bounding rect of the block the caret sits in, used to anchor popovers at the
// block being edited instead of at the caret line. The block element is found
// by walking the DOM up from the caret (view.domAtPos) to the closest <p>, <li>,
// <h1-6>, blockquote, <pre> or table cell — far more reliable than resolving
// through view.nodeDOM, which can return the editor root or a container node at
// block boundaries. Horizontal edges are pinned to the editor container
// (.ProseMirror) so the popover aligns with the editor's content column; only
// the vertical edges come from the block itself.
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td"

export function getBlockRectAt(view: EditorView, pos: number): FlipAnchorRect | null {
  let el: HTMLElement | null = null
  try {
    const { node } = view.domAtPos(pos)
    el = node instanceof HTMLElement ? node : node.parentElement
  } catch {
    el = null
  }
  while (el && el !== view.dom) {
    if (el.matches(BLOCK_SELECTOR)) {
      const block = el.getBoundingClientRect()
      const editor = view.dom.getBoundingClientRect()
      if (block.width === 0 && block.height === 0) return null
      return { left: editor.left, top: block.top, bottom: block.bottom, right: editor.right }
    }
    el = el.parentElement
  }
  return null
}
