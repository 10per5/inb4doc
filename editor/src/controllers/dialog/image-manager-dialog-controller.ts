import { BaseDialogController } from "./base-dialog-controller"

export class ImageManagerDialogController extends BaseDialogController {
  review(e: Event) {
    const url = (e.currentTarget as HTMLElement).dataset.url
    if (url) window.open(url, "_blank")
  }

  async delete(e: Event) {
    const name = (e.currentTarget as HTMLElement).dataset.name
    if (!name) return
    if (!confirm(`Delete "${name}"?`)) return

    const { imageRepository } = await import("@/repositories/imageRepository")
    const { showNotification } = await import("@/components/notification/notification")

    try {
      await imageRepository.deleteImage(name)
      const row = (e.currentTarget as HTMLElement).closest(".img-row") as HTMLElement
      row.remove()
      const remaining = this.element.querySelectorAll(".img-row").length
      if (remaining === 0) {
        showNotification("All images deleted", { type: "info" })
        this.cancel()
      }
      showNotification(`Deleted ${name}`, { type: "info" })
    } catch (err: any) {
      showNotification(`Failed to delete: ${err.message}`, { type: "danger" })
    }
  }

  copy(e: Event) {
    const storage = (e.currentTarget as HTMLElement).dataset.storage
    if (!storage) return
    const embed = `![](${storage})`
    navigator.clipboard.writeText(embed).then(() => {
      import("@/components/notification/notification").then(({ showNotification }) => {
        showNotification("Copied to clipboard", { type: "info" })
      })
    })
  }
}
