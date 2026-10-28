import type { ZipFileEntry } from "@/utils/zip"
import { openDialog } from "@/services/dialog-service"

/** What an import does when the path is already taken. */
export type ImportExistingMode = "replace" | "append" | "merge"

export interface ImportDialogResult {
  selected: ZipFileEntry[]
  mode: ImportExistingMode
}

export function openImportZipDialog(
  entries: ZipFileEntry[],
  onImport: (result: ImportDialogResult) => void,
) {
  const newEntries = entries.filter(e => !e.exists)
  const replaceEntries = entries.filter(e => e.exists)

  openDialog<{ selected: ZipFileEntry[]; mode?: ImportExistingMode }>("import-zip-dialog", { newEntries, replaceEntries })
    .promise.then((result) => {
      if (result) {
        onImport({
          selected: result.selected as ZipFileEntry[],
          mode: (result.mode as ImportExistingMode) ?? "replace",
        })
      }
    })
}
