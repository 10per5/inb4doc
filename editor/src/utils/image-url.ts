/** The on-disk file name of a committed image reference, or null when the
 *  reference is not a file (external URL, pending upload, base64/blob). */
export function imageFileName(src: string): string | null {
  if (src.startsWith("inb4doc-image:")) {
    const n = src.slice("inb4doc-image:".length);
    return n || null;
  }
  if (
    /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(src) &&
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !src.startsWith("data:") &&
    !src.startsWith("blob:") &&
    !src.startsWith("pending-image:")
  ) {
    const base = src.split("/").pop()!;
    return base || null;
  }
  return null;
}

/** Doc dir owning an image URL, e.g. "/docs/editor/image/foo.png" →
 *  "docs/editor". Empty when the image lives at the content root. */
export function imageDirFromSrc(src: string): string {
  const s = src.replace(/^\//, "");
  const idx = s.lastIndexOf("/image/");
  return idx >= 0 ? s.slice(0, idx) : "";
}
