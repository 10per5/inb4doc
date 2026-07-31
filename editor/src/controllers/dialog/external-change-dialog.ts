import { openDialog } from "@/services/dialog-service"
import { navArrowRight } from "@/eta/icons"

export type ExternalChangeAction = "discard" | "keep"

export function openExternalChangeDialog(
  path: string,
  localContent: string,
  diskContent: string,
): Promise<ExternalChangeAction> {
  return openDialog<ExternalChangeAction>("external-change-dialog", {
    path,
    local: localContent,
    disk: diskContent,
    icons: { navArrowRight },
  }).promise.then((action) => action ?? "discard")
}
