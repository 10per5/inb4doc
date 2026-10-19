import type { EditorView } from "prosemirror-view"
import { prefsStore } from "@/stores/preferences-store"
import { appEvents, AppEvent } from "@/stores/app-events"

/**
 * Writing assistance — own the browser's spell-check surface instead of
 * leaving it to chance.
 *
 * The editor relies on the browser for typo detection (there is no bundled
 * dictionary), which means two settings decide what the author sees:
 *
 * - `spellcheck` toggles whether anything is underlined at all (`spellcheck`
 *   attribute on the content root).
 * - `spellcheckLanguages` (opt-in BCP-47 tags) decide which dictionary the
 *   browser asks for. The first entry becomes the root's `lang`; the rest are
 *   published as a comma-separated `data-spell-langs` hint and as a secondary
 *   `lang` on inline unknowns is NOT attempted — browsers only honor a single
 *   language per subtree.
 *
 * Styling of the resulting decorations is CSS-side (::spelling-error /
 * ::grammar-error), see src/styles/editor/spellcheck.css.
 */
export interface SpellcheckState {
  enabled: boolean
  lang: string
  languages: string[]
}

const ROOT_ATTR = "data-spellcheck"

export function readSpellcheckState(): SpellcheckState {
  const languages = prefsStore.spellcheckLanguages
  return {
    enabled: prefsStore.spellcheck && languages.length > 0,
    lang: languages[0] ?? "",
    languages,
  }
}

export function applySpellcheck(view: EditorView | null): void {
  if (!view) return
  const { enabled, lang, languages } = readSpellcheckState()
  const dom = view.dom as HTMLElement
  dom.spellcheck = enabled
  dom.setAttribute(ROOT_ATTR, enabled ? "on" : "off")
  if (lang) dom.lang = lang
  else dom.removeAttribute("lang")
  if (languages.length) dom.dataset.spellLangs = languages.join(",")
  else delete dom.dataset.spellLangs
}

/**
 * Keep every editor live-updated after the preference changes. Returns the
 * unsubscribe so the caller owns the lifetime (same shape as the other
 * editor-facing services in this project).
 */
export function initSpellcheck(getView: () => EditorView | null): () => void {
  const unsub = appEvents.on(AppEvent.SpellcheckChanged, () => {
    applySpellcheck(getView())
  })
  return unsub
}
