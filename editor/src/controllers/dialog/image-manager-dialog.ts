import { imageService } from "@/services/image-service"
import { openDialog } from "@/services/dialog-service"

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

  openDialog("image-manager-dialog", { title, dir, loadError, allEntries })
}
