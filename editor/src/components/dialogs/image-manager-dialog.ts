import { imageRepository } from "@/repositories/imageRepository"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderImageManagerDialog from "@/eta/dialogs/image-manager-dialog"

export async function openImageManagerDialog(): Promise<void> {
  const dir = imageRepository.getCurrentDocDir()

  let entries: Awaited<ReturnType<typeof imageRepository.listImages>> = []
  let loadError: string | null = null
  try {
    entries = await imageRepository.listImages(true)
  } catch (e: any) {
    loadError = e.message
  }

  const allEntries = imageRepository.getAllImages()

  const title = dir
    ? `Image Manager <span style="font-weight:400;font-size:0.9rem;color:var(--color-text-tertiary)">— ${dir}</span>`
    : "Image Manager"

  const html = renderImageManagerDialog({ title, loadError, allEntries })

  openHtmlDialogPromise({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  })
}
