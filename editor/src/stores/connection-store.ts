/**
 * ConnectionStore — holds remote server connection config.
 *
 * Persists to localStorage so the connection survives session restarts.
 * RemoteProvider reads from here to build its base URL.
 * Tracks whether the remote server is reachable (set by dialog Try probe).
 */

import { hasFunc, AppFunc } from "$/build/build-mode";

const STORAGE_KEY = "inb4doc-connection"

export interface ConnectionConfig {
  host: string
  port: number
}

const DEFAULTS: ConnectionConfig = {
  host: "localhost",
  port: 3000,
}

function load(): ConnectionConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return null
}

function save(config: ConnectionConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {}
}

class ConnectionStore {
  private config: ConnectionConfig | null = load()
  private _remoteAvailable = false

  getHost(): string { return this.config?.host ?? DEFAULTS.host }
  getPort(): number { return this.config?.port ?? DEFAULTS.port }

  getConfig(): ConnectionConfig { return this.config ? { ...this.config } : { ...DEFAULTS } }

  setConfig(host: string, port: number): void {
    this.config = { host, port }
    save(this.config)
    this._remoteAvailable = false
  }

  isCustom(): boolean { return this.config !== null }

  getBaseUrl(): string {
    return `http://${this.getHost()}:${this.getPort()}`
  }

  get remoteAvailable(): boolean { return this._remoteAvailable }
  set remoteAvailable(v: boolean) { this._remoteAvailable = v }

  /** True when the configured host is explicitly an app:// endpoint. */
  isAppScheme(): boolean {
    const host = this.config?.host ?? ""
    return host.startsWith("app://")
  }

  /** True when the editor is loaded inside the inb4doc GUI (app:// scheme). */
  isInsideAppGui(): boolean {
    return typeof window !== "undefined" && window.location.protocol === "app:"
  }

  /** Probe the server and update remoteAvailable. Returns the result. */
  async probe(timeout = 3000): Promise<boolean> {
    if (this.isAppScheme() || this.isInsideAppGui() || !hasFunc(AppFunc.AllowProbe)) {
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
