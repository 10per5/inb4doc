import { openDialog } from "@/services/dialog-service"

export interface VideoDialogAttrs {
  src: string
  width: string
  height: string
  controls: boolean
  loop: boolean
  muted: boolean
  autoplay: boolean
}

export type VideoDialogResult =
  | { action: "save" } & VideoDialogAttrs
  | { action: "remove" }

export function openVideoDialog(
  current: VideoDialogAttrs,
): Promise<VideoDialogResult | null> {
  const inputId = "inb4doc-video-input-" + Math.random().toString(36).slice(2)
  const widthId = "inb4doc-video-width-" + Math.random().toString(36).slice(2)
  const heightId = "inb4doc-video-height-" + Math.random().toString(36).slice(2)

  return openDialog<VideoDialogResult>("video-dialog", { inputId, widthId, heightId, current }).promise
}
