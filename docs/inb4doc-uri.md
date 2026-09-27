# `inb4doc://` URI Scheme — Share-by-Link Specification (Serverless)

> **Status:** Proposed — `v1`. Open for audit.
> **Scope:** serverless, inline-compressed payload. No network, no server.
> **Deferred:** provider sync / microservice / self-deleting pastebin → see `deferred-server.md`.

---

## 1. Goals

- Share a markdown document over chat apps by pasting a compact, self-contained URI.
- Open that same URI **natively** on Linux desktop, Android, and (later) web PWA.
- Optional **passphrase encryption**; the key may ride inside the URI (`?pw=`) or be entered manually.
- **Local-first:** no server, no telemetry. The document only leaves the device inside the link the user chooses to copy.

## 2. Non-goals

- No hosting, no pastebin, no provider replication (deferred).
- No large-document transport beyond chat-app message length (deferred server handles that).
- Not a replacement for the vault / provider filesystem — a shared doc is a read-only import with an explicit **Save to vault** action.

---

## 3. URI grammar

```
inb4doc://<ver>/doc/<PAYLOAD>[?pw=<key>][&h=<sha256>][&t=<title>][&s=<salt>]
```

| Part | Required | Meaning |
|------|----------|---------|
| `inb4doc` | yes | Scheme. Native/desktop/Android. Web registers `web+inb4doc` (browser restriction) or accepts `https://app/#inb4doc:…`. |
| `<ver>` | yes | Integer version; currently `1`. |
| `doc` | yes | Route segment → decoder. |
| `<PAYLOAD>` | yes | `base64url` of the encoded bytes (see §4). |
| `pw` | no | URL-safe passphrase. Presence ⇒ AES-GCM path; absence ⇒ app prompts. |
| `h` | no | Lowercase hex **SHA-256 of the final plaintext markdown** — integrity check + future dedup hint. |
| `t` | no | Suggested title (URL-encoded) for the imported doc. |
| `s` | no | Optional PBKDF2 salt (hex). Absent ⇒ fixed app salt (see §5). |

### Web variance
Browsers only permit `navigator.registerProtocolHandler` for `web+<name>` schemes, so the web build registers **`web+inb4doc:`**. A `https://app/#inb4doc:…` hash fallback covers environments without a protocol handler. The decode pipeline is identical; only the prefix differs.

---

## 4. Payload encoding

### 4.1 Byte layout (before base64url)

```
[ flags: 1 byte ][ body ]
```

`flags` bit 0:
- `0x00` → body = `deflateRaw( plaintextUTF8 )`
- `0x01` → body = `AES-GCM( deflateRaw( plaintextUTF8 ), key, iv )`

When encrypted, the AES-GCM output is stored as `iv(12) ‖ ciphertext ‖ tag(16)` (the standard Web Crypto layout, with the 12-byte IV prepended so the decoder can recover it).

### 4.2 Encode order (critical)

```
plaintext (UTF-8)
  → c = deflateRaw(plaintext)          # compress FIRST (ciphertext is high-entropy and won't compress)
  → if pw: e = AES-GCM(c, key, iv)     # encrypt the *compressed* bytes
  → body = [flags] + (e or c)
  → PAYLOAD = base64url(body)
```

Decode is the exact inverse: `base64url-decode → body → read flags → (AES-GCM-decrypt → c) → inflateRaw(c) → plaintext`.

### 4.3 Why these choices

- **Raw DEFLATE** (`deflate-raw` / `DecompressionStream('deflate-raw')`) matches zlib raw inflate, so a future native (C++/Kotlin) decoder can reuse zlib with no header juggling. Decode is done in JS for all platforms today.
- **Compress before encrypt**, never after — otherwise DEFLATE sees ciphertext and gains nothing.
- **`base64url`** over base85: maximal chat/URI safety. (~33% size overhead; acceptable. base85 is a later optimization if link length becomes the bottleneck.)
- **`flags` byte** removes ambiguity: the decoder knows whether the payload is encrypted and therefore whether to demand a passphrase, even when `pw` is omitted from the URI.

---

## 5. Encryption details

- **KDF:** `PBKDF2(pw, salt, iterations = 100_000, sha-256) → 256-bit key`.
  - Default `salt` = a fixed application constant. Trade-off: identical passphrases yield identical keys (acceptable for this use; not a megafold). A per-link `&s=<salt>` may be added later for stronger KDF separation.
- **Cipher:** AES-256-GCM, 96-bit IV (random per encryption, prepended to output), 128-bit tag.
- **`pw` carries the human passphrase** (not the derived key) so the recipient types/pastes the same string. Putting the derived key in the URI would be equivalent obfuscation; the passphrase is friendlier.
- **Manual fallback:** if `flags == 0x01` and no `pw` is present, the app shows a passphrase prompt and derives the key from user input.

> **Security note:** a key carried in `?pw=` is *obfuscation, not secrecy* — anyone with the full link can decrypt. Real confidentiality means sharing the passphrase **out-of-band** and omitting `pw` (the app then prompts). Document this clearly in the UI.

---

## 6. Integrity

- `h` = `SHA-256(plaintext)`, hex lowercase. After decode, recompute and compare; mismatch ⇒ warn (corruption or tamper). Doubles as a content-addressable id when a server is added later (see `deferred-server.md`), so the field is defined now to stay forward-compatible.

---

## 7. Platform integration

### 7.1 Desktop (Linux) — primary
- **`scripts/install.sh` → `install_desktop()`** extends the existing entry:
  - `MimeType=text/markdown;x-scheme-handler/inb4doc;`
  - `Exec="$PREFIX/inb4doc-gui" %u` (handles `inb4doc://` URIs) and `.md` open via `%f` (already supported: `content_root` positional accepts a `.md` file path).
  - After writing: `xdg-settings set default-url-scheme-handler inb4doc inb4doc.desktop` (and `update-desktop-database`).
  - Result: appears in **rofi/dmenu**; opens `.md` files; claims `inb4doc://` links.
- **`gui/src/args.cpp` / `args.h`**: recognize an `inb4doc://…` token (positional or `--open`) and forward it to the webview via the existing bridge/`app://` scheme so the **JS decoder** runs. No C++ DEFLATE/AES reimplementation needed.

### 7.2 Android APK — primary
- Add an Android **intent-filter** `<data android:scheme="inb4doc" />` to the launcher activity so `inb4doc://` links launch the app.
- On intent, extract the URI and pass it into the **same web layer** (bridge) as desktop.
- **Spike first:** confirm how the `gui-mobile` build surfaces incoming intents (Qt Android `onNewIntent` / manifest wiring) — this is the one unknown to resolve before full build.

### 7.3 Web PWA — documented follow-up (not now)
- `navigator.registerProtocolHandler('web+inb4doc', '%s')` at app load.
- A **Share / Copy link** action plus optional **QR** (QR only viable for small notes / future short links).
- Because browsers restrict raw `inb4doc://`, the web registers `web+inb4doc:` and also accepts `https://app/#inb4doc:…`.

---

## 8. Editor implementation (shared across desktop + Android + future web)

- **`src/utils/inb4doc-uri.ts`**
  - `parseInb4doc(uri): { ver, payload, pw?, hash?, title?, salt? }`
  - `decodeInb4doc(uri): Promise<string>` — `base64url`-decode → read `flags` → (AES-GCM-decrypt with key from `pw` or prompt) → `DecompressionStream('deflate-raw')` → plaintext. Recompute/verify `h` if present.
  - `encodeInb4doc(markdown, { pw?, title? }): Promise<string>` — inverse, using `CompressionStream('deflate-raw')` + `crypto.subtle`.
- **`src/stores/app-events.ts`**: add `AppEvent.OpenSharedDoc { markdown, title? }`.
- **Shared-doc view**: open the decoded markdown as a **read-only "shared" document** with a **Save to vault** button (does **not** auto-write to any provider).
- **Bootstrap**: web + gui check the initial URI / argv for `inb4doc://` and dispatch `OpenSharedDoc`.

---

## 9. Examples

```
# Plain, unencrypted
inb4doc://1/doc/lZX5…k
  → decodes to: "# Hello\n\nWorld"

# Encrypted, key in URI
inb4doc://1/doc/9cz…m?pw=correct-horse&t=Note

# With integrity hash
inb4doc://1/doc/9cz…m?pw=correct-horse&h=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

---

## 10. Limits & risks

- **Size:** serverless inline is bounded by chat-app message length (Discord ~2 KB, Telegram ~4 KB, WhatsApp ~64 KB) and by **QR capacity (~2–3 KB)**. The Share UI must warn when the encoded link exceeds a threshold; large docs → deferred server.
- **Key-in-URI** is obfuscation, not secrecy (see §5).
- **Forward compatibility:** the `ver` segment + `flags` byte allow future formats (base85, server `link` variant) without breaking existing decoders.
- **Unicode:** all transforms operate on UTF-8 bytes.

---

## 11. Open questions (for audit)

1. PBKDF2 salt: fixed app salt now; add `&s=` later?
2. Exact chat-app length thresholds that trigger the "link too long" warning.
3. Should the web build *also* register `web+inb4doc` now, or stay fully deferred?
4. Naming: keep `doc` route, or use `note`/`md`? (`doc` chosen for forward-compat with a future `link` route.)
