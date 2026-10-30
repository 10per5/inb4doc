/**
 * Scroll helpers — the one place that knows where the app scrolls.
 *
 * The document scrolls in `.book-layout` (a sibling of the fixed topbar/dock),
 * but the editor content can also sit inside nested scrollable ancestors. That
 * lookup used to be re-done with `document.querySelector` in five modules, each
 * with its own `scrollTop` math. Keep the element lookup and the visible-band
 * calculations here so the selectors stay consistent.
 */

let mainScroller: HTMLElement | null = null

/** The app's main document scroller, or null before the shell has rendered. */
export function scrollContainer(): HTMLElement | null {
  if (mainScroller?.isConnected) return mainScroller
  mainScroller = document.querySelector<HTMLElement>(".book-layout")
  return mainScroller
}

/** Nearest ancestor of `el` that actually scrolls vertically. */
export function scrollParentOf(el: Element | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      /(auto|scroll|overlay)/.test(overflowY) &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

export interface VerticalSpan {
  top: number
  bottom: number
}

/** Scroll `container` just enough to bring `span` into its visible band. */
export function scrollSpanIntoView(
  span: VerticalSpan,
  container: HTMLElement | null = scrollContainer(),
  padding = 12,
): void {
  if (!container) return
  const box = container.getBoundingClientRect()
  const visibleTop = box.top + padding
  const visibleBottom = box.bottom - padding
  if (span.top >= visibleTop && span.bottom <= visibleBottom) return

  if (span.top < visibleTop) {
    container.scrollTop -= visibleTop - span.top
  } else if (span.bottom > visibleBottom) {
    container.scrollTop += span.bottom - visibleBottom
  }
}

/** Scroll so `span` sits in the middle of the visible band. */
export function centerSpan(
  span: VerticalSpan,
  container: HTMLElement | null = scrollContainer(),
): void {
  if (!container) return
  const box = container.getBoundingClientRect()
  const mid = (span.top + span.bottom) / 2
  const delta = mid - (box.top + box.height / 2)
  if (Number.isFinite(delta) && Math.abs(delta) > 1) {
    container.scrollTop += delta
  }
}

/** Reset the main scroller to the top or the bottom. */
export function scrollMainTo(toTop: boolean): void {
  const container = scrollContainer()
  if (!container) return
  container.scrollTop = toTop ? 0 : container.scrollHeight
  container.scrollLeft = 0
}
