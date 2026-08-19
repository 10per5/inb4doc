/**
 * The formatting state at the current editor selection — which marks are
 * active and what heading the caret sits in. Emitted by the text-state plugin
 * and consumed by the toolbar to reflect the current text state (h/b/i/s).
 */
export interface TextState {
  /** `bold` mark active at the selection. */
  bold: boolean
  /** `italic` mark active at the selection. */
  italic: boolean
  /** `strike` mark active at the selection. */
  strike: boolean
  /** `code` mark active at the selection. */
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
