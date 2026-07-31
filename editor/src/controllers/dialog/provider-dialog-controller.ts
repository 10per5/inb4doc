import { BaseDialogController } from "./base-dialog-controller"
import { ProviderType } from "@/providers/index"
import { connectionStore } from "@/stores/connection-store"
import { infoCircle, warningCircle } from "@/eta/icons"
import renderProviderDialog from "@/eta/views/dialog/provider-dialog"

export const ProviderDialogEvent = {
  Select: "provider-dialog:select",
  Probe:  "provider-dialog:probe",
  Accept: "provider-dialog:accept",
  Cancel: "provider-dialog:cancel",
  ProbeResult: "provider-dialog:probe-result",
} as const

export interface ProviderPayload {
  currentProvider: ProviderType
  currentInfo: { icon: string; label: string }
  providers: Array<{
    type: ProviderType
    description: string
    available: boolean
    reason?: string
  }>
  badges: Record<string, { icon: string; label: string }>
  icons: { infoCircle: string; warningCircle: string }
}

export class ProviderDialogController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: ProviderPayload

  private selectedType: ProviderType | null = null
  private remoteAvailable = false
  private hasProbed = false

  connect() {
    this.selectedType = this.payloadValue.currentProvider
    this.remoteAvailable = connectionStore.remoteAvailable
    this.element.addEventListener(ProviderDialogEvent.ProbeResult, ((e: CustomEvent<{ remoteAvailable: boolean }>) => {
      this.onProbeResult(e)
    }) as EventListener)
    this.render()
    if (this.selectedType === ProviderType.Remote) this.probe()
  }

  render() {
    const p = this.payloadValue
    const conn = connectionStore.getConfig()
    this.element.innerHTML = renderProviderDialog({
      ProviderType,
      currentInfo: p.currentInfo,
      providers: p.providers,
      selectedType: this.selectedType,
      currentProvider: p.currentProvider,
      badges: p.badges,
      conn,
      initialStatusClass: this.hasProbed ? (this.remoteAvailable ? "ok" : "err") : "",
      initialStatusText: this.hasProbed
        ? (this.remoteAvailable ? `${infoCircle} Online` : "Server unreachable")
        : "Server status unknown",
      canAccept: this.selectedType != null && (this.selectedType !== ProviderType.Remote || this.remoteAvailable),
      icons: { infoCircle, warningCircle },
    })
  }

  selectProvider(e: Event) {
    const type = Number((e.currentTarget as HTMLElement).dataset.type)
    if (Number.isNaN(type)) return
    this.selectedType = type as ProviderType
    this.render()
    if (this.selectedType === ProviderType.Remote) this.probe()
  }

  stopPropagation(e: Event) {
    e.stopPropagation()
  }

  probe() {
    const statusEl = this.element.querySelector(".remote-status")
    if (statusEl) {
      statusEl.textContent = ""
      statusEl.className = "remote-status"
    }

    setTimeout(() => {
      const inputs = this.element.querySelectorAll(".remote-field input")
      const host = (inputs[0] as HTMLInputElement)?.value.trim() || "localhost"
      const port = parseInt((inputs[1] as HTMLInputElement)?.value || "3000", 10)
      this.dispatch("probe", { detail: { host, port }, bubbles: true })
    }, 600)
  }

  scheduleProbe() {
    this.probe()
  }

  onProbeResult(e: CustomEvent<{ remoteAvailable: boolean }>) {
    this.remoteAvailable = e.detail.remoteAvailable
    this.hasProbed = true

    const el = this.element.querySelector(".remote-status")
    if (el) {
      el.innerHTML = this.remoteAvailable ? `${infoCircle} Online` : "Server unreachable"
      el.className = "remote-status " + (this.remoteAvailable ? "ok" : "err")
    }

    const btn = this.element.querySelector(".inb4doc-btn-success") as HTMLButtonElement | null
    if (btn) {
      btn.disabled = this.selectedType == null || (this.selectedType === ProviderType.Remote && !this.remoteAvailable)
    }
  }

  cancel() {
    this.dispatch("cancel", { bubbles: true })
  }

  accept() {
    if (this.selectedType == null) return
    if (this.selectedType === ProviderType.Remote && !this.remoteAvailable) return
    this.dispatch("accept", { detail: String(this.selectedType), bubbles: true })
  }
}
