/**
 * The formatting state at the current editor selection — which marks are
 * active and what heading the caret sits in. Emitted by the text-state plugin
 * and consumed by the toolbar to reflect the current text state (h/b/i/s).
 */
export interface TextState {
  /** `strong` mark active at the selection. */
  bold: boolean
  /** `emphasis` mark active at the selection. */
  italic: boolean
  /** `strike_through` mark active at the selection. */
  strike: boolean
  /** `inlineCode` mark active at the selection. */
  code: boolean
  /** `link` mark active at the selection (caret inside a hyperlink). */
  link: boolean
  /** Heading level of the active block, `0` outside a heading. */
  heading: number
}

export const EMPTY_TEXT_STATE: TextState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  heading: 0,
}
