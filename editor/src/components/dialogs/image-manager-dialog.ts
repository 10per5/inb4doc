import { imageService } from "@/services/image-service"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderImageManagerDialog from "@/eta/dialogs/image-manager-dialog"

export async function openImageManagerDialog(): Promise<void> {
  const dir = imageService.getCurrentDocDir()

  let entries: Awaited<ReturnType<typeof imageService.listImages>> = []
  let loadError: string | null = null
  try {
    entries = await imageService.listImages(true)
  } catch (e: any) {
    loadError = e.message
  }

  const allEntries = imageService.getAllImages()

  const title = "Image Manager"

  const html = renderImageManagerDialog({ title, dir, loadError, allEntries })

  openHtmlDialogPromise({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  })
}
