import { openDialog } from "@/services/dialog-service"

export interface VideoDialogResult {
  src: string
  width: string
  height: string
  controls: boolean
  loop: boolean
  muted: boolean
  autoplay: boolean
}

export function openVideoDialog(
  current: VideoDialogResult,
  onSave: (result: VideoDialogResult) => void,
  onRemove: () => void,
) {
  const inputId = "inb4doc-video-input-" + Math.random().toString(36).slice(2)
  const widthId = "inb4doc-video-width-" + Math.random().toString(36).slice(2)
  const heightId = "inb4doc-video-height-" + Math.random().toString(36).slice(2)

  openDialog<VideoDialogResult>("video-dialog", { inputId, widthId, heightId, current })
    .promise.then((result) => {
      if (result === null) {
        onRemove()
      } else {
        onSave(result)
      }
    })
}
