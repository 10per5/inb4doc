import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderExternalChangeDialog from "@/eta/dialogs/external-change-dialog"
import { navArrowRight } from "@/eta/icons"

export type ExternalChangeAction = "discard" | "keep"

export function openExternalChangeDialog(
  path: string,
  localContent: string,
  diskContent: string,
): Promise<ExternalChangeAction> {
  const html = renderExternalChangeDialog({ path, local: localContent, disk: diskContent, icons: { navArrowRight } })

  return openHtmlDialogPromise<ExternalChangeAction>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }).then((action) => action ?? "discard")
}
