import { hasFunc, AppFunc } from "$/build/build-mode"
import { storageService } from "@/services/storage-service"
import type { ConnectionConfig } from "@/services/storage-service"
import { ProviderType } from "@/providers"
import { STORE_CONNECTIONS } from "@/config/storage-keys"

const DEFAULTS: ConnectionConfig = {
  host: "localhost",
  port: 3000,
}

class ConnectionStore {
  private config: ConnectionConfig | null = null

  private get remoteId(): string {
    return String(ProviderType.Remote)
  }

  private tryLoadConfig(): void {
    if (this.config) return
    const stored = storageService.getJSON<{ host: string; port: number }>(STORE_CONNECTIONS, this.remoteId)
    if (stored && typeof stored.host === "string" && typeof stored.port === "number") {
      this.config = { host: stored.host, port: stored.port }
    }
  }

  private _remoteAvailable = false

  getHost(): string { this.tryLoadConfig(); return this.config?.host ?? DEFAULTS.host }
  getPort(): number { this.tryLoadConfig(); return this.config?.port ?? DEFAULTS.port }

  getConfig(): ConnectionConfig { this.tryLoadConfig(); return this.config ? { ...this.config } : { ...DEFAULTS } }

  setConfig(host: string, port: number): void {
    this.config = { host, port }
    storageService.setJSON(STORE_CONNECTIONS, this.remoteId, { host, port })
    this._remoteAvailable = false
  }

  isCustom(): boolean { this.tryLoadConfig(); return this.config !== null }

  getBaseUrl(): string {
    return `http://${this.getHost()}:${this.getPort()}`
  }

  get remoteAvailable(): boolean { return this._remoteAvailable }
  set remoteAvailable(v: boolean) { this._remoteAvailable = v }

  async probe(timeout = 3000): Promise<boolean> {
    if (!hasFunc(AppFunc.AllowProbe)) {
      this._remoteAvailable = false
      return false
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(this.getBaseUrl() + "/api/tree", {
        method: "HEAD",
        signal: controller.signal,
      })
      clearTimeout(timer)
      this._remoteAvailable = res.ok || res.status === 200
    } catch {
      clearTimeout(timer)
      this._remoteAvailable = false
    }
    return this._remoteAvailable
  }
}

export const connectionStore = new ConnectionStore()
