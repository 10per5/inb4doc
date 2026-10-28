/**
 * The file clipboard — what Ctrl+X / Ctrl+V move around the explorer.
 *
 * In-memory on purpose: the durable half of a cut is the pending Delete it
 * queues (that survives a reload), while the carried contents do not need to.
 * A cut page therefore stays visible, struck through, until it is pasted
 * somewhere or flushed away with Ctrl+S.
 */
export interface FileClipboardEntry {
  /** Document the contents came from. */
  path: string
  /** Full document — frontmatter included — so a paste rebuilds the page. */
  content: string
  /** `cut` marks the source for deletion; `copy` leaves the source alone. */
  mode: "cut" | "copy"
}

let entry: FileClipboardEntry | null = null

export function getFileClipboard(): FileClipboardEntry | null {
  return entry
}

export function setFileClipboard(next: FileClipboardEntry | null): void {
  entry = next
}

export function clearFileClipboard(): void {
  entry = null
}
