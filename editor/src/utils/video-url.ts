// Hosted-video URL detection + embed-URL normalization for the `video` node.
//
// Direct media-file URLs (mp4/webm/ogg/…) play natively in a <video> element.
// YouTube/Vimeo links must be rendered as <iframe> embeds — a bare
// `<video src="https://youtube.com/...">` is rejected by browsers with
// "no video with supported format and MIME type found".

const YOUTUBE_ID =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d+)/i

/**
 * Return the embeddable iframe URL for a YouTube/Vimeo link, or `null` when the
 * src is a direct media file (or unrecognized). The returned URL is already in
 * embed form, so callers can use it straight as an `<iframe src>`.
 */
export function getVideoEmbedUrl(src: string): string | null {
  if (!src) return null
  const yt = src.match(YOUTUBE_ID)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = src.match(VIMEO_ID)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
}

/** True when `src` is a YouTube/Vimeo link that must render as an iframe. */
export function isHostedVideoUrl(src: string): boolean {
  return getVideoEmbedUrl(src) !== null
}
