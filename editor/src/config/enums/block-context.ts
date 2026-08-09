export type ListBlockKind = "bullet" | "ordered" | "task"

export interface ActiveBlockContext {
  isListItem: boolean
  listType: ListBlockKind | null
  checked: boolean | null
  /** True when the item is not the first child of its parent list, so it can sink deeper. */
  canSink: boolean
}

export const EMPTY_BLOCK_CONTEXT: ActiveBlockContext = {
  isListItem: false,
  listType: null,
  checked: null,
  canSink: false,
}
