import { html, render } from "lit-html"
import { miniWindow, actionBtn, overlayStyles, windowStyles } from "@/components/ui/ui-helpers"
import { getAvailableProviders, type ProviderInfo } from "@/providers"

export interface ProviderDialogResult {
  type: "remote" | "filesystem" | "localStorage"
}

export async function mountProviderDialog(
  currentProvider: string,
): Promise<ProviderDialogResult | null> {
  const providers = await getAvailableProviders()

  return new Promise((resolve) => {
    const overlay = document.createElement("div")
    overlay.id = "predoc-dialog-overlay"
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 1000; display: flex; align-items: center; justify-content: center;
    `
    overlay.addEventListener("click", () => {
      overlay.remove()
      resolve(null)
    })

    function choose(type: "remote" | "filesystem" | "localStorage") {
      overlay.remove()
      resolve({ type })
    }

    const providerBadges: Record<string, { icon: string; label: string }> = {
      remote: { icon: "☁️", label: "Server (Remote)" },
      filesystem: { icon: "💻", label: "Local Files" },
      localStorage: { icon: "🗄️", label: "Browser Storage" },
    }

    const currentInfo = providerBadges[currentProvider] || { icon: "❓", label: currentProvider }

    const body = html`
      <div class="provider-dialog-body">
        <div class="provider-current">
          Currently using: <strong>${currentInfo.icon} ${currentInfo.label}</strong>
        </div>
        <div class="provider-options">
          ${providers.map(
            (p) => html`
              <div
                class="provider-option ${p.available ? "" : "provider-option-disabled"} ${p.type === currentProvider ? "provider-option-active" : ""}"
                @click=${p.available && p.type !== currentProvider ? () => choose(p.type) : undefined}
                role="button"
                tabindex=${p.available ? "0" : "-1"}
              >
                <div class="provider-option-icon">${providerBadges[p.type]?.icon || "❓"}</div>
                <div class="provider-option-info">
                  <div class="provider-option-name">${providerBadges[p.type]?.label || p.type}</div>
                  <div class="provider-option-desc">${p.description}</div>
                  ${!p.available && p.reason
                    ? html`<div class="provider-option-reason">⛔ ${p.reason}</div>`
                    : ""}
                  ${p.type === currentProvider
                    ? html`<div class="provider-option-current-badge">current</div>`
                    : ""}
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `

    const actions = html`
      ${actionBtn({ label: "Cancel", variant: "default" })}
    `

    render(
      html`
        <style>
          ${overlayStyles}${windowStyles}
          .provider-dialog-body {
            padding: 0.5rem 0;
          }
          .provider-dialog-body {
            padding: 0.5rem 0;
          }
          .provider-current {
            font-size: 0.9rem;
            margin-bottom: 1rem;
            padding: 0.5rem 0.75rem;
            background: var(--color-bg-tertiary);
            border-radius: 6px;
            color: var(--color-text-primary);
          }
          .provider-options {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
          .provider-option {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.75rem;
            border: 1px solid var(--color-border);
            border-radius: 6px;
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
            color: var(--color-text-primary);
          }
          .provider-option:hover:not(.provider-option-disabled):not(.provider-option-active) {
            border-color: var(--color-accent);
            background: var(--color-bg-tertiary);
          }
          .provider-option-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .provider-option-active {
            border-color: var(--color-accent);
            background: var(--color-bg-tertiary);
          }
          .provider-option-icon {
            font-size: 1.5rem;
            flex-shrink: 0;
            margin-top: 0.1rem;
          }
          .provider-option-info {
            flex: 1;
            min-width: 0;
          }
          .provider-option-name {
            font-weight: 600;
            font-size: 0.95rem;
            color: var(--color-text-primary);
          }
          .provider-option-desc {
            font-size: 0.8rem;
            color: var(--color-text-tertiary);
            margin-top: 0.15rem;
          }
          .provider-option-reason {
            font-size: 0.8rem;
            color: var(--color-error);
            margin-top: 0.25rem;
          }
          .provider-option-current-badge {
            display: inline-block;
            font-size: 0.7rem;
            padding: 0.1rem 0.4rem;
            border-radius: 3px;
            background: var(--color-accent);
            color: #fff;
            margin-top: 0.25rem;
          }
        </style>
        <div class="predoc-window" @click=${(e: MouseEvent) => e.stopPropagation()}>
          <div class="predoc-window-header">Change Project</div>
          <div class="predoc-window-body">${body}</div>
          <div class="predoc-window-actions">${actions}</div>
        </div>
      `,
      overlay,
    )

    document.body.appendChild(overlay)

    const cancelBtn = overlay.querySelector(".predoc-btn") as HTMLButtonElement
    cancelBtn?.addEventListener("click", () => {
      overlay.remove()
      resolve(null)
    })
  })
}
