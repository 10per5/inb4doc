export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif)$/i
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mpg|mpeg|avi|mkv|wmv|flv|3gp)$/i

/** True for files we can reasonably treat as raster/vector images. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true
  if (file.type.startsWith("video/")) return false
  return IMAGE_EXT_RE.test(file.name)
}

/** True for video files (so the image-upload path can reject them cleanly). */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true
  return VIDEO_EXT_RE.test(file.name)
}
