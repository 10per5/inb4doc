// `inb4doc://` URI scheme — serverless share-by-link codec.
//
// Full spec: docs/inb4doc-uri.md
//
// Payload layout (before base64url):
//   [ flags: 1 byte ][ body ]
//   flags bit0: 0 = raw deflate(plaintext); 1 = AES-GCM( deflate(plaintext) )
//
// Encode order: compress FIRST (ciphertext is incompressible), then encrypt.
// Decode is the inverse. The same pipeline is reused by the future `link`
// (server) variant — only transport differs.

const FIXED_SALT = new Uint8Array([
  105, 110, 98, 52, 100, 111, 99, 45, 115, 104, 97, 114, 101, 45, 118, 49,
]) // "inb4doc-share-v1" — KDF separation only, NOT secret
const PBKDF2_ITERATIONS = 100_000

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlToBytes(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/")
  while (b.length % 4) b += "="
  const bin = atob(b)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw")
  const writer = cs.writable.getWriter()
  void writer.write(bytes as BufferSource)
  void writer.close()
  const buf = await new Response(cs.readable).arrayBuffer()
  return new Uint8Array(buf)
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw")
  const writer = ds.writable.getWriter()
  void writer.write(bytes as BufferSource)
  void writer.close()
  const buf = await new Response(ds.readable).arrayBuffer()
  return new Uint8Array(buf)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function deriveKey(pw: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
    const km = await crypto.subtle.importKey(
      "raw",
      enc.encode(pw) as BufferSource,
      "PBKDF2",
      false,
      ["deriveKey"],
    )
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export interface EncodeOptions {
  pw?: string
  title?: string
}

/**
 * Encode markdown into an `inb4doc://1/doc/...` URI.
 * `pw` present → AES-256-GCM (PBKDF2-derived key) wraps the deflated bytes and
 * the passphrase is carried as `?pw=` for convenience (share the passphrase
 * out-of-band for real secrecy). Always appends `?h=` integrity hash.
 */
export async function encodeInb4doc(
  markdown: string,
  opts: EncodeOptions = {},
): Promise<string> {
  const enc = new TextEncoder()
  const plaintext = enc.encode(markdown)
  const compressed = await deflateRaw(plaintext)

  let body: Uint8Array
  let flags = 0x00
  const pw = opts.pw?.length ? opts.pw : undefined
  if (pw) {
    const key = await deriveKey(pw, FIXED_SALT)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      compressed as BufferSource,
    )
    body = concat(iv, new Uint8Array(ct))
    flags = 0x01
  } else {
    body = compressed
  }

  const payload = bytesToBase64url(concat(new Uint8Array([flags]), body))

  const params: string[] = []
  if (pw) params.push("pw=" + encodeURIComponent(pw))
  if (opts.title) params.push("t=" + encodeURIComponent(opts.title))
  params.push("h=" + (await sha256Hex(plaintext)))

  return `inb4doc://1/doc/${payload}` + (params.length ? "?" + params.join("&") : "")
}

export interface ParsedInb4doc {
  ver: number
  payload: string
  pw?: string
  hash?: string
  title?: string
}

export function parseInb4doc(uri: string): ParsedInb4doc {
  const m = uri.trim().match(/^inb4doc:\/\/(\d+)\/doc\/(.+)$/)
  if (!m) throw new Error("Not an inb4doc:// URI")
  const ver = Number(m[1])
  let rest = m[2]
  let query = ""
  const qIdx = rest.indexOf("?")
  if (qIdx >= 0) {
    query = rest.slice(qIdx + 1)
    rest = rest.slice(0, qIdx)
  }
  const params = new URLSearchParams(query)
  return {
    ver,
    payload: rest,
    pw: params.get("pw") ?? undefined,
    hash: params.get("h") ?? undefined,
    title: params.get("t") ?? undefined,
  }
}

/**
 * Decode an `inb4doc://` URI back to markdown. For encrypted payloads the
 * passphrase must be supplied via `?pw=` or passed in `opts.pw`; otherwise it
 * throws. Verifies the `?h=` integrity hash (warns on mismatch, non-fatal).
 */
export async function decodeInb4doc(
  uri: string,
  opts: { pw?: string } = {},
): Promise<string> {
  const parsed = parseInb4doc(uri)
  const bytes = base64urlToBytes(parsed.payload)
  const flags = bytes[0]
  let body = bytes.subarray(1)
  if (flags & 0x01) {
    const pw = opts.pw ?? parsed.pw
    if (!pw) throw new Error("This link is encrypted — a passphrase is required")
    const key = await deriveKey(pw, FIXED_SALT)
    const iv = body.subarray(0, 12)
    const ct = body.subarray(12)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    )
    body = new Uint8Array(plain)
  }
  const inflated = await inflateRaw(body)
  const text = new TextDecoder().decode(inflated)
  if (parsed.hash) {
    const actual = await sha256Hex(new TextEncoder().encode(text))
    if (actual !== parsed.hash) {
      console.warn("inb4doc: integrity hash mismatch (corrupted or tampered)")
    }
  }
  return text
}

/** Cheap peek: does this URI carry an encrypted payload (flags bit0 set)? */
export function isEncryptedUri(uri: string): boolean {
  try {
    const m = uri.trim().match(/^inb4doc:\/\/\d+\/doc\/(.+)$/)
    if (!m) return false
    let rest = m[1]
    const q = rest.indexOf("?")
    if (q >= 0) rest = rest.slice(0, q)
    const bytes = base64urlToBytes(rest)
    return (bytes[0] & 0x01) === 0x01
  } catch {
    return false
  }
}
