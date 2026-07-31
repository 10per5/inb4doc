import { openDialog } from "@/services/dialog-service"

export function openLinkDialog(initialUrl: string): Promise<string | null> {
  const inputId = "inb4doc-link-input-" + Math.random().toString(36).slice(2)

  return openDialog<string>("link-dialog", { inputId, initialUrl }).promise
}
