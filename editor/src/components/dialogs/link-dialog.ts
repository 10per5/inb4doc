import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderLinkDialog from "@/eta/dialogs/link-dialog"

export function openLinkDialog(initialUrl: string): Promise<string | null> {
  const inputId = "inb4doc-link-input-" + Math.random().toString(36).slice(2)

  const html = renderLinkDialog({ inputId, initialUrl })

  return openHtmlDialogPromise<string>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  })
}
