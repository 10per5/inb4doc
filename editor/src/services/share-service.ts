import { openDialog } from "@/services/dialog-service"

export interface ShareSendPayload {
  content: string
  title?: string
}

export function openShareSendDialog(content: string, title?: string): void {
  openDialog("share-send-dialog", { content, title } satisfies ShareSendPayload)
}

export function openShareOpenDialog(initialUri?: string): void {
  openDialog("share-open-dialog", { uri: initialUri ?? "" })
}
