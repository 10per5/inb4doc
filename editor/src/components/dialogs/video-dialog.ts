import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderVideoDialog from "@/eta/dialogs/video-dialog"

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

  const html = renderVideoDialog({ inputId, widthId, heightId, current })

  openHtmlDialogPromise<VideoDialogResult | null>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }).then((result) => {
    if (result === null) {
      onRemove()
    } else {
      onSave(result)
    }
  })
}
