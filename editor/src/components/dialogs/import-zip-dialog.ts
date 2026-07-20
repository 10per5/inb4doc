import type { ZipFileEntry } from "@/utils/zip"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderImportZipDialog from "@/eta/dialogs/import-zip-dialog"

export interface ImportDialogResult {
  selected: ZipFileEntry[]
}

export function openImportZipDialog(
  entries: ZipFileEntry[],
  onImport: (result: ImportDialogResult) => void,
) {
  const newEntries = entries.filter(e => !e.exists)
  const replaceEntries = entries.filter(e => e.exists)

  const html = renderImportZipDialog({ newEntries, replaceEntries })

  openHtmlDialogPromise<{ selected: ZipFileEntry[] }>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }).then((result) => {
    if (result) {
      onImport({ selected: result.selected as ZipFileEntry[] })
    }
  })
}
