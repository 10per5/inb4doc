import { openDialog } from "@/services/dialog-service"
import { imageFileName } from "@/utils/image-url"

export type ImageDialogPayload = {
  mode: "create" | "edit"
  pos: number
  src: string
  attrs: Record<string, unknown>
}

export type ImageDialogResult =
  | { action: "save"; src: string; alt: string; caption: string }
  | { action: "remove" }

/** Payload handed to the Eta template (id/derived fields added by the helper). */
export type ImageDialogViewPayload = ImageDialogPayload & {
  urlId: string
  altId: string
  captionId: string
  fileId: string
  isBlock: boolean
  isInline: boolean
  alt: string
  caption: string
  fileName: string | null
}

/**
 * Open the image dialog (create or edit mode) via the state-driven dialog
 * host. Resolves with the editor action to take: `save` (with the final src
 * after any on-disk rename, plus the alt/caption field values) or `remove`;
 * `null` means the user cancelled and nothing should change.
 */
export function openImageDialog(
  payload: ImageDialogPayload,
): Promise<ImageDialogResult | null> {
  const urlId = "inb4doc-image-url-" + Math.random().toString(36).slice(2)
  const altId = "inb4doc-image-alt-" + Math.random().toString(36).slice(2)
  const captionId = "inb4doc-image-caption-" + Math.random().toString(36).slice(2)
  const fileId = "inb4doc-image-file-" + Math.random().toString(36).slice(2)
  const a = payload.attrs ?? {}
  const isBlock = "caption" in a || "ratio" in a
  const isInline = "alt" in a || "title" in a
  const viewPayload: ImageDialogViewPayload = {
    ...payload,
    urlId,
    altId,
    captionId,
    fileId,
    isBlock,
    isInline,
    alt: typeof a.alt === "string" ? a.alt : "",
    caption:
      typeof (isBlock ? a.caption : a.title) === "string"
        ? ((isBlock ? a.caption : a.title) as string)
        : "",
    fileName: payload.mode === "edit" ? imageFileName(payload.src) : null,
  }
  return openDialog<ImageDialogResult>("image-dialog", viewPayload).promise
}
