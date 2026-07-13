import { html, render } from "lit-html"
import { actionBtn, overlayStyles, windowStyles, buttonStyles } from "@/components/ui/ui-helpers"
import { getAvailableProviders } from "@/stores/provider-store"
import { connectionStore } from "@/stores/connection-store"
import type { ProviderType } from "@/providers/index"

export interface ProviderDialogResult {
  type: ProviderType
  configChanged: boolean
}

export async function mountProviderDialog(
  currentProvider: string,
): Promise<ProviderDialogResult | null> {
  const providers = await getAvailableProviders()
  await connectionStore.probe()

  return new Promise((resolve) => {
    const overlay = document.createElement("div")
    overlay.id = "inb4doc-dialog-overlay"
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 1000; display: flex; align-items: center; justify-content: center;
    `
    overlay.addEventListener("click", () => {
      overlay.remove()
      resolve(null)
    })

    let selectedType: ProviderType | null = currentProvider as ProviderType

    function accept() {
      if (!selectedType) return
      const cur = connectionStore.getConfig()
      const configChanged = cur.host !== origHost || cur.port !== origPort
      overlay.remove()
      resolve({ type: selectedType, configChanged })
    }

    const providerBadges: Record<string, { icon: string; label: string }> = {
      remote: { icon: "☁️", label: "Server (Remote)" },
      filesystem: { icon: "💻", label: "Local Files" },
      localStorage: { icon: "🗄️", label: "Browser Storage" },
    }

    const currentInfo = providerBadges[currentProvider] || { icon: "❓", label: currentProvider }
    const conn = connectionStore.getConfig()
    const origHost = conn.host
    const origPort = conn.port

    function renderBody() {
      const remoteAvailable = connectionStore.remoteAvailable
      const remoteAppFallback = providers.find((p) => p.type === "remote")?.appFallback ?? false
      const remoteGuiFallback = providers.find((p) => p.type === "remote")?.guiFallback ?? false
      const remoteReason = !remoteAvailable
        ? (remoteAppFallback
            ? "inb4doc app://_/ endpoint is used"
            : remoteGuiFallback
              ? "ℹ️ inb4doc-gui local API is used"
              : "Server not reachable — enter host/port and wait")
        : undefined

      const mergedProviders = providers.map((p) => ({
        ...p,
        // The remote option is selectable when the server is reachable OR the
        // embedded GUI app:// content API is being used as a fallback.
        // Otherwise it stays disabled.
        available: p.type === "remote" ? (remoteAvailable || remoteAppFallback || remoteGuiFallback) : p.available,
        reason: p.type === "remote" ? remoteReason : p.reason,
      }))

      const body = html`
        <div class="provider-dialog-body">
          <div class="provider-current">
            Currently using: <strong>${currentInfo.icon} ${currentInfo.label}</strong>
          </div>
          <div class="provider-options">
            ${mergedProviders.map(
              (p) => html`
                <div
                  class="provider-option ${p.available ? "" : "provider-option-disabled"} ${selectedType === p.type ? "provider-option-selected" : ""} ${p.type === currentProvider ? "provider-option-active" : ""}"
                  data-type=${p.type}
                  @click=${p.available ? () => { selectedType = p.type; renderBody() } : undefined}
                  role="button"
                  tabindex=${p.available ? "0" : "-1"}
                >
                  <div class="provider-option-icon">${providerBadges[p.type]?.icon || "❓"}</div>
                  <div class="provider-option-info">
                    <div class="provider-option-name">${providerBadges[p.type]?.label || p.type}</div>
                    <div class="provider-option-desc">${p.description}</div>
                    ${p.reason && p.type !== "remote"
                      ? html`<div class="provider-option-reason ${(p as any).appFallback || (p as any).guiFallback ? "info" : ""}">${(p as any).appFallback || (p as any).guiFallback ? "ℹ️" : "⛔"} ${p.reason}</div>`
                      : ""}
                    ${p.type === currentProvider
                      ? html`<div class="provider-option-current-badge">current</div>`
                      : ""}
                    ${p.type === "remote" ? renderRemoteSection() : ""}
                  </div>
                </div>
              `,
            )}
          </div>
        </div>
      `
      render(
        html`
          <style>
            ${overlayStyles}${windowStyles}${buttonStyles}
            .provider-dialog-body { padding: 0.5rem 0; }
            .provider-current {
              font-size: 0.9rem; margin-bottom: 1rem; padding: 0.5rem 0.75rem;
              background: var(--color-bg-tertiary); border-radius: 6px;
              color: var(--color-text-primary);
            }
            .provider-options { display: flex; flex-direction: column; gap: 0.5rem; }
            .provider-option {
              display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem;
              border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer;
              transition: border-color 0.15s, background 0.15s; color: var(--color-text-primary);
            }
            .provider-option:hover:not(.provider-option-disabled):not(.provider-option-active):not(.provider-option-selected) {
              border-color: var(--color-accent); background: var(--color-bg-tertiary);
            }
            .provider-option-disabled { opacity: 0.5; cursor: not-allowed; }
            .provider-option-active {
              border-color: var(--color-border); background: var(--color-bg-secondary);
              opacity: 0.85;
            }
            .provider-option-active::before {
              content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
              border-radius: 6px 0 0 6px; background: var(--color-success, #28a745);
            }
            .provider-option { position: relative; }
            .provider-option-selected {
              border-color: var(--color-accent); background: var(--color-bg-tertiary);
              box-shadow: inset 0 0 0 1px var(--color-accent);
            }
            .provider-option-icon { font-size: 1.5rem; flex-shrink: 0; margin-top: 0.1rem; }
            .provider-option-info { flex: 1; min-width: 0; }
            .provider-option-name { font-weight: 600; font-size: 0.95rem; color: var(--color-text-primary); }
            .provider-option-desc { font-size: 0.8rem; color: var(--color-text-tertiary); margin-top: 0.15rem; }
            .provider-option-reason { font-size: 0.8rem; color: var(--color-error); margin-top: 0.25rem; }
            .provider-option-reason.info { color: var(--color-info, #3b82f6); }
            .provider-option-current-badge {
              display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.4rem;
              border-radius: 3px; background: var(--color-accent); color: #fff; margin-top: 0.25rem;
            }
            .remote-section { margin-top: 0.5rem; }
            .remote-fields { display: flex; gap: 0.5rem; align-items: end; }
            .remote-field { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
            .remote-field label { font-size: 0.75rem; color: var(--color-text-tertiary); }
            .remote-field input {
              padding: 0.35rem 0.5rem; border: 1px solid var(--color-border); border-radius: 4px;
              font-size: 0.85rem; background: var(--color-bg-primary); color: var(--color-text-primary);
              width: 100%; box-sizing: border-box;
            }
            .remote-field input:focus { outline: none; border-color: var(--color-accent); }
            .remote-status { font-size: 0.8rem; margin-top: 0.3rem; min-height: 1.2rem; }
            .remote-status.ok { color: var(--color-success, #28a745); }
            .remote-status.err { color: var(--color-error); }
            .remote-status.warn { color: var(--color-warning, #d9822b); }
            .remote-status.info { color: var(--color-info, #3b82f6); }
          </style>
          <div class="inb4doc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
            <div class="inb4doc-window-header">Change Project</div>
            <div class="inb4doc-window-body">${body}</div>
            <div class="inb4doc-window-actions">
              ${actionBtn({ label: "Cancel", variant: "danger" })}
              ${actionBtn({ label: "Accept", variant: "success", disabled: !selectedType })}
            </div>
          </div>
        `,
        overlay,
      )

      document.body.appendChild(overlay)

      const btns = overlay.querySelectorAll(".inb4doc-btn")
      const cancelBtn = btns[0] as HTMLButtonElement
      const acceptBtn = btns[1] as HTMLButtonElement
      cancelBtn?.addEventListener("click", () => {
        overlay.remove()
        resolve(null)
      })
      acceptBtn?.addEventListener("click", accept)
    }

    function renderRemoteSection() {
      const hostId = "conn-host-" + Math.random().toString(36).slice(2)
      const portId = "conn-port-" + Math.random().toString(36).slice(2)
      const statusId = "conn-status-" + Math.random().toString(36).slice(2)

      let probeTimer: ReturnType<typeof setTimeout> | null = null

      function scheduleProbe() {
        if (probeTimer) clearTimeout(probeTimer)
        const statusEl = document.getElementById(statusId)
        if (statusEl) { statusEl.textContent = ""; statusEl.className = "remote-status" }

        probeTimer = setTimeout(() => {
          const host = (document.getElementById(hostId) as HTMLInputElement)?.value.trim() || "localhost"
          const port = parseInt((document.getElementById(portId) as HTMLInputElement)?.value || "3000", 10)

          // An explicit app:// host (app://_/, app://, app://_) uses the
          // embedded content API directly — no HTTP server to probe.
          const appFallback =
            host === "app://" || host === "app://_" || host.startsWith("app://_/")

          const remoteCard = overlay.querySelector('.provider-option[data-type="remote"]') as HTMLElement
          const acceptBtn = overlay.querySelectorAll(".inb4doc-btn")[1] as HTMLButtonElement
          const reasonEl = remoteCard?.querySelector(".provider-option-reason")

          if (appFallback) {
            connectionStore.setConfig(host, port)
            if (statusEl) {
              statusEl.textContent = "ℹ️ inb4doc-gui local API is used"
              statusEl.className = "remote-status info"
            }
            remoteCard?.classList.remove("provider-option-disabled")
            remoteCard && (remoteCard.style.cursor = "pointer")
            if (selectedType === "remote") acceptBtn.disabled = false
            return
          }

          connectionStore.setConfig(host, port)
          connectionStore.probe().then((ok) => {
            const inGuiMode = connectionStore.isInsideAppGui()
            const isDefaultHost = host === "localhost" || host === "127.0.0.1"
            const guiFallback = !ok && inGuiMode && (isDefaultHost || appFallback)

            if (guiFallback) {
              if (statusEl) {
                statusEl.textContent = "ℹ️ inb4doc-gui local API is used"
                statusEl.className = "remote-status info"
              }
              remoteCard?.classList.remove("provider-option-disabled")
              remoteCard && (remoteCard.style.cursor = "pointer")
              if (selectedType === "remote") acceptBtn.disabled = false
              return
            }

            if (statusEl) {
              statusEl.textContent = ok
                ? "✓ Online"
                : "ℹ️ Server unavailable, falling back to inb4doc-gui app://_/"
              statusEl.className = "remote-status " + (ok ? "ok" : "info")
            }
            if (remoteCard) {
              remoteCard.classList.remove("provider-option-disabled")
              remoteCard.style.cursor = "pointer"
              if (!ok) reasonEl?.remove()
              if (selectedType === "remote") acceptBtn.disabled = false
            }
          })
        }, 600)
      }

      const initialStatus = connectionStore.remoteAvailable
        ? html`<div id="${statusId}" class="remote-status ok">✓ Online</div>`
        : html`<div id="${statusId}" class="remote-status"></div>`

      return html`
        <div class="remote-section" @click=${(e: Event) => e.stopPropagation()}>
          <div class="remote-fields">
            <div class="remote-field">
              <label for="${hostId}">Host</label>
              <input id="${hostId}" type="text" value="${conn.host}" placeholder="localhost"
                @input=${() => scheduleProbe()}>
            </div>
            <div class="remote-field" style="max-width: 80px">
              <label for="${portId}">Port</label>
              <input id="${portId}" type="number" value="${conn.port}" placeholder="3000"
                @input=${() => scheduleProbe()}>
            </div>
          </div>
          ${initialStatus}
        </div>
      `
    }

    renderBody()
  })
}
