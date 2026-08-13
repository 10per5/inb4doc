import { Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { EditorView } from "@milkdown/kit/prose/view"

const CARET_MARGIN = 12

// Mobile-only tap handler (registered only on mobile docks by editor-config).
// On a press that moves the caret, nudge the document scroll so the caret stays
// in the visible band between the fixed topbar and the bottom dock — the
// browser's native caret-into-view scroll doesn't know about the fixed chrome,
// so a tap near an edge can leave the caret hidden behind the dock.
let tapStartFrom = -1

export function createCaretScrollPlugin() {
  return new Plugin({
    key: new PluginKey("inb4doc-caret-scroll"),
    props: {
      handleDOMEvents: {
        // Pointer events fire before touch/mouse, so at pointerdown the
        // selection still holds the pre-tap caret. Compare it at pointerup to
        // only act on taps that actually moved the caret — finger-scroll
        // gestures end with an unchanged selection and must not yank it back.
        pointerdown: (view) => {
          tapStartFrom = view.state.selection.from
          return false
        },
        pointerup: (view) => {
          requestAnimationFrame(() => scrollCaretIntoView(view))
          return false
        },
      },
    },
  })
}

function scrollCaretIntoView(view: EditorView): void {
  if (view.state.selection.from === tapStartFrom) return
  const { from } = view.state.selection
  const caret = view.coordsAtPos(from)
  if (!caret) return
  const scrollEl = document.querySelector<HTMLElement>(".book-layout")
  if (!scrollEl) return

  // Layout-viewport coordinates: both coordsAtPos and the fixed chrome rects
  // are relative to the layout viewport, so the comparison holds whether or
  // not the visual viewport has panned for the on-screen keyboard.
  const topbar = document
    .querySelector<HTMLElement>(".app-toolbar")
    ?.getBoundingClientRect()
  const dock = document
    .querySelector<HTMLElement>("#dock")
    ?.getBoundingClientRect()
  const topInset = topbar ? topbar.bottom + CARET_MARGIN : 0
  const bottomInset = dock ? dock.top - CARET_MARGIN : window.innerHeight

  let delta = 0
  if (caret.top < topInset) {
    delta = caret.top - topInset
  } else if (caret.bottom > bottomInset) {
    delta = caret.bottom - bottomInset
  }
  if (delta) scrollEl.scrollTop += delta
}
