import type { ZipFileEntry } from "@/utils/zip"
import { openDialog } from "@/services/dialog-service"

export interface ImportDialogResult {
  selected: ZipFileEntry[]
}

export function openImportZipDialog(
  entries: ZipFileEntry[],
  onImport: (result: ImportDialogResult) => void,
) {
  const newEntries = entries.filter(e => !e.exists)
  const replaceEntries = entries.filter(e => e.exists)

  openDialog<{ selected: ZipFileEntry[] }>("import-zip-dialog", { newEntries, replaceEntries })
    .promise.then((result) => {
      if (result) {
        onImport({ selected: result.selected as ZipFileEntry[] })
      }
    })
}
