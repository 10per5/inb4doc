export type ListBlockKind = "bullet" | "ordered" | "task"

export interface ActiveBlockContext {
  isListItem: boolean
  listType: ListBlockKind | null
  checked: boolean | null
}

export const EMPTY_BLOCK_CONTEXT: ActiveBlockContext = {
  isListItem: false,
  listType: null,
  checked: null,
}
