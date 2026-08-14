import { BaseDialogController } from "./base-dialog-controller"
import renderImageDialog from "@/eta/views/dialog/image-dialog"
import { imageService } from "@/services/image-service"
import { showToast } from "@/bridge"
import { imageFileName, imageDirFromSrc } from "@/utils/image-url"
import type { ImageDialogViewPayload, ImageDialogResult } from "./image-dialog.type"

export class ImageDialogController extends BaseDialogController {
  static targets = ["url", "suggestions", "upload", "alt", "caption", "file"]
  static values = { payload: Object }

  declare urlTarget: HTMLInputElement
  declare suggestionsTarget: HTMLElement
  declare uploadTarget: HTMLInputElement
  declare readonly hasAltTarget: boolean
  declare readonly altTarget: HTMLInputElement
  declare readonly hasCaptionTarget: boolean
  declare readonly captionTarget: HTMLInputElement
  declare readonly hasFileTarget: boolean
  declare readonly fileTarget: HTMLInputElement

  declare payloadValue: ImageDialogViewPayload

  connect() {
    this.element.innerHTML = renderImageDialog(this.payloadValue)
    this.renderSuggestions()
    this.focusInput(`#${CSS.escape(this.payloadValue.urlId)}`, { raf: true })
  }

  onEnter() {
    this.save()
  }

  async renderSuggestions() {
    const el = this.suggestionsTarget
    try {
      await imageService.listImages()
    } catch {}
    const allImages = imageService.getAllImages()
    if (allImages.length === 0) {
      el.innerHTML = '<div class="inb4doc-image-empty">No images yet</div>'
      return
    }
    el.innerHTML = allImages
      .slice(0, 3)
      .map(
        (img) => `
      <button type="button" class="inb4doc-image-suggestion" data-url="${img.url}" data-action="click->image-dialog#pick">
        <img src="${img.url}" alt="">
        <span>${img.name}</span>
        ${img.pending ? '<em>(pending)</em>' : ""}
      </button>
    `,
      )
      .join("")
  }

  pick(e: Event) {
    const url = (e.currentTarget as HTMLElement).dataset.url || ""
    this.urlTarget.value = url
    this.save()
  }

  uploadChange() {
    const file = this.uploadTarget.files?.[0]
    if (!file) return
    imageService.uploadImage(file).then((url) => {
      this.urlTarget.value = url
      this.save()
    })
  }

  async save() {
    const result = await this.buildResult()
    if (result) this.confirm(result)
  }

  private async buildResult(): Promise<ImageDialogResult | null> {
    const url = this.urlTarget.value.trim()
    if (!url) {
      showToast("Image URL is required", { type: "danger" })
      return null
    }
    let finalUrl = url
    if (this.hasFileTarget) {
      const newName = this.fileTarget.value.trim()
      if (newName) {
        const oldName = imageFileName(this.payloadValue.src)
        if (oldName && newName !== oldName) {
          try {
            finalUrl = await imageService.renameImage(
              oldName,
              newName,
              imageDirFromSrc(this.payloadValue.src),
            )
          } catch (e) {
            showToast(
              e instanceof Error ? e.message : "Rename failed",
              { type: "danger" },
            )
            return null
          }
        }
      }
    }
    return {
      action: "save",
      src: finalUrl,
      alt: this.hasAltTarget ? this.altTarget.value.trim() : "",
      caption: this.hasCaptionTarget ? this.captionTarget.value.trim() : "",
    }
  }

  remove() {
    this.confirm({ action: "remove" })
  }
}
