// Shared popover flip logic: measure a hidden panel, then toggle the
// toolbar-menu--up / toolbar-menu--right classes (and clamp horizontally) so
// it stays on screen. Extracted from Menu.positionPanel() so the dock
// quick-actions menu, the block-handle menu, and the mobile edit-toolbar
// popover share one implementation. The classes are defined in
// src/styles/ui/menu.css.

import type { EditorView } from "@milkdown/kit/prose/view"

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

// Bounding rect of the block node containing the document position — the
// deepest block ancestor (paragraph, heading, code block, list item, …). Used
// to anchor popovers at the block the user is editing instead of at the caret
// line. The rect comes from the block's DOM element (view.nodeDOM at the
// node's start position), so it tracks scroll/keyboard offsets.
export function getBlockRectAt(view: EditorView, pos: number): FlipAnchorRect | null {
  const $pos = view.state.doc.resolve(pos)
  let depth = $pos.depth
  while (depth > 0 && !$pos.node(depth).isBlock) depth--
  if (depth === 0) return null
  const el = view.nodeDOM($pos.before(depth)) as HTMLElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right }
}
