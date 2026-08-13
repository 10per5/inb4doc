/**
 * The kinds of block the quick/edit toolbar has a button mapping for.
 * `None` = no toolbar context (plain paragraph, heading, …).
 */
export enum ActiveBlockType {
  None = 0,
  BulletList = 1,
  OrderedList = 2,
  TaskList = 3,
  Table = 4,
  Blockquote = 5,
}

export interface ActiveBlockContext {
  type: ActiveBlockType
  /** Task list only: the item's checked state (null outside task lists). */
  checked: boolean | null
  /** List items only: true when not the first child of its parent list, so it can sink deeper. */
  canSink: boolean
}

export const EMPTY_BLOCK_CONTEXT: ActiveBlockContext = {
  type: ActiveBlockType.None,
  checked: null,
  canSink: false,
}
