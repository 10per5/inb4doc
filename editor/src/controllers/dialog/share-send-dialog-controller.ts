import { BaseDialogController } from "./base-dialog-controller"
import { encodeInb4doc } from "@/utils/inb4doc-uri"
import renderShareSendDialog from "@/eta/views/dialog/share-send-dialog"

export class ShareSendDialogController extends BaseDialogController {
  static values = { payload: Object }
  declare payloadValue: { content: string; title?: string }

  private mode: "raw" | "encrypted" = "raw"
  private pw = ""

  // Chat-app inline-link length heuristic (spec §10). Tunable; open question #2.
  private static readonly LINK_LENGTH_WARN = 2000

  connect() {
    this.element.innerHTML = renderShareSendDialog(this.payloadValue)
    void this.generate()
  }

  onEnter() {
    void this.copy()
  }

  onModeChange(e: Event) {
    this.mode = (e.target as HTMLInputElement).value === "encrypted" ? "encrypted" : "raw"
    this.updatePwVisibility()
    void this.generate()
  }

  onPassInput(e: Event) {
    this.pw = (e.target as HTMLInputElement).value
    if (this.mode === "encrypted") void this.generate()
  }

  private updatePwVisibility() {
    const wrap = this.element.querySelector<HTMLElement>("[data-share-pw]")
    if (wrap) wrap.hidden = this.mode !== "encrypted"
  }

  private async generate() {
    const out = this.element.querySelector<HTMLTextAreaElement>("[data-share-output]")
    if (!out) return
    if (this.mode === "encrypted" && this.pw.length === 0) {
      out.value = ""
      this.setStatus("Enter a passphrase to encrypt the link.")
      return
    }
    try {
      out.value = await encodeInb4doc(this.payloadValue.content, {
        pw: this.mode === "encrypted" ? this.pw : undefined,
        title: this.payloadValue.title,
      })
      this.setLengthWarning(out.value.length)
      if (out.value.length <= ShareSendDialogController.LINK_LENGTH_WARN) this.setStatus("")
    } catch (err) {
      out.value = ""
      this.setLengthWarning(0)
      this.setStatus("Failed to generate link: " + (err as Error).message)
    }
  }

  private setLengthWarning(len: number) {
    const el = this.element.querySelector<HTMLElement>("[data-share-warn]")
    if (!el) return
    if (len > ShareSendDialogController.LINK_LENGTH_WARN) {
      el.hidden = false
      el.textContent = `⚠ Link is ${len} chars — may exceed chat-app limits (Discord ~2 KB). Large docs need the server option.`
    } else {
      el.hidden = true
      el.textContent = ""
    }
  }

  async copy() {
    const out = this.element.querySelector<HTMLTextAreaElement>("[data-share-output]")
    if (!out || !out.value) return
    try {
      await navigator.clipboard.writeText(out.value)
      this.setStatus("Copied to clipboard.")
    } catch {
      out.select()
      this.setStatus("Press Ctrl+C / Cmd+C to copy.")
    }
  }

  private setStatus(msg: string) {
    const el = this.element.querySelector<HTMLElement>("[data-share-status]")
    if (el) el.textContent = msg
  }
}
