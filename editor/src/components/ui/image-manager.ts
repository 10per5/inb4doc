import { imageService } from "@/services/image-service"
import type { ImageEntry } from "@/providers/provider"

export interface ImageManagerData {
  dir: string
  loadError: string | null
  allEntries: (ImageEntry & { pending?: boolean })[]
}

export interface ImageManagerDataOptions {
  onAllImagesDeleted?: () => void
}

/** Loads the current directory + all known images (dialog and screen both use this). */
export async function loadImageManagerData(): Promise<ImageManagerData> {
  const dir = imageService.getCurrentDocDir()

  let loadError: string | null = null
  try {
    await imageService.listImages(true)
  } catch (e: any) {
    loadError = e.message
  }

  return { dir, loadError, allEntries: imageService.getAllImages() }
}

/**
 * Imperatively wires the review/delete/copy row actions. The row markup is
 * shared between the desktop dialog and the mobile screen (see
 * templates/views/image-manager-rows.eta), so the actions attach here instead
 * of via controller-specific Stimulus actions.
 */
export function bindImageManagerActions(
  container: HTMLElement,
  { onAllImagesDeleted }: ImageManagerDataOptions = {}
): void {
  container.querySelectorAll<HTMLButtonElement>(".img-review").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.url
      if (url) window.open(url, "_blank")
    })
  })

  container.querySelectorAll<HTMLButtonElement>(".img-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleDelete(btn, container, onAllImagesDeleted)
    })
  })

  container.querySelectorAll<HTMLButtonElement>(".img-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const storage = btn.dataset.storage
      if (!storage) return
      const embed = `![](${storage})`
      navigator.clipboard.writeText(embed).then(() => {
        import("@/components/notification/notification").then(({ showNotification }) => {
          showNotification("Copied to clipboard", { type: "info" })
        })
      })
    })
  })
}

async function handleDelete(
  btn: HTMLButtonElement,
  container: HTMLElement,
  onAllImagesDeleted?: () => void
): Promise<void> {
  const name = btn.dataset.name
  if (!name) return
  if (!confirm(`Delete "${name}"?`)) return

  const { imageService: svc } = await import("@/services/image-service")
  const { showNotification } = await import("@/components/notification/notification")

  try {
    await svc.deleteImage(name)
    btn.closest(".img-row")?.remove()
    const remaining = container.querySelectorAll(".img-row").length
    if (remaining === 0) {
      showNotification("All images deleted", { type: "info" })
      onAllImagesDeleted?.()
    }
    showNotification(`Deleted ${name}`, { type: "info" })
  } catch (err: any) {
    showNotification(`Failed to delete: ${err.message}`, { type: "danger" })
  }
}
