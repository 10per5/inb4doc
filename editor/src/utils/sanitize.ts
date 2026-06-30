const ALLOWED_IMG_EXTS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]

export function sanitizeImageName(name: string): string {
  const dot = name.lastIndexOf(".")
  const rawExt = dot >= 0 ? name.slice(dot).toLowerCase() : ""
  const extBody = rawExt.replace(".", "")
  const safeExt = ALLOWED_IMG_EXTS.includes(extBody) ? rawExt : ".png"
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base || "image"}-${suffix}${safeExt}`
}
