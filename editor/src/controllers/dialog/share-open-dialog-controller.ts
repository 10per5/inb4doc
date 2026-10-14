import { BaseDialogController } from "./base-dialog-controller"
import { decodeInb4doc, isEncryptedUri, parseInb4doc } from "@/utils/inb4doc-uri"
import { appEvents, AppEvent } from "@/stores/app-events"
import renderShareOpenDialog from "@/eta/views/dialog/share-open-dialog"

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return base || "shared-note"
}

export class ShareOpenDialogController extends BaseDialogController {
  static values = { payload: Object }
  declare payloadValue: { uri?: string }

  private uri = ""
  private pw = ""
  private integrityAck = false

  connect() {
    this.element.innerHTML = renderShareOpenDialog(this.payloadValue)
    const initial = typeof this.payloadValue.uri === "string" ? this.payloadValue.uri : ""
    if (initial) {
      this.uri = initial
      const ta = this.element.querySelector<HTMLTextAreaElement>("[data-open-uri]")
      if (ta) ta.value = initial
      this.syncPwVisibility()
    }
  }

  onEnter() {
    void this.open()
  }

  onUriInput(e: Event) {
    this.uri = (e.target as HTMLTextAreaElement).value
    this.integrityAck = false
    this.syncPwVisibility()
  }

  onPassInput(e: Event) {
    this.pw = (e.target as HTMLInputElement).value
  }

  async paste() {
    const ta = this.element.querySelector<HTMLTextAreaElement>("[data-open-uri]")
    try {
      const text = await navigator.clipboard.readText()
      this.uri = text.trim()
      if (ta) {
        ta.value = this.uri
        this.integrityAck = false
        this.syncPwVisibility()
      }
    } catch {
      this.setStatus("Clipboard read blocked — paste the link manually.")
    }
  }

  private syncPwVisibility() {
    const wrap = this.element.querySelector<HTMLElement>("[data-open-pw-wrap]")
    if (!wrap) return
    const encrypted = isEncryptedUri(this.uri)
    wrap.hidden = !encrypted
    if (!encrypted) {
      this.pw = ""
      const p = this.element.querySelector<HTMLInputElement>("[data-open-pw]")
      if (p) p.value = ""
      return
    }
    try {
      const parsed = parseInb4doc(this.uri)
      if (parsed.pw) {
        this.pw = parsed.pw
        const p = this.element.querySelector<HTMLInputElement>("[data-open-pw]")
        if (p) p.value = parsed.pw
      }
    } catch {
      // ignore; user can type the passphrase
    }
  }

  async open() {
    this.setStatus("")
    if (!this.uri.trim()) {
      this.setStatus("Paste or enter an inb4doc:// link first.")
      return
    }
    let decoded: string
    let mismatch = false
    try {
      decoded = await decodeInb4doc(this.uri, {
        pw: this.pw,
        onIntegrity: (m) => {
          mismatch = m
        },
      })
    } catch (err) {
      this.setStatus("Could not open link: " + (err as Error).message)
      return
    }
    if (mismatch && !this.integrityAck) {
      this.integrityAck = true
      this.setStatus("⚠ Integrity check failed (corrupted or tampered). Click Open again to import anyway.")
      return
    }
    const titleMatch = decoded.match(/^#\s+(.+)$/m)
    const path = slugify(titleMatch ? titleMatch[1] : "shared-note")
    appEvents.emit(AppEvent.OpenSharedDocRequested, { path, content: decoded })
    this.cancel()
  }

  private setStatus(msg: string) {
    const el = this.element.querySelector<HTMLElement>("[data-open-status]")
    if (el) el.textContent = msg
  }
}
