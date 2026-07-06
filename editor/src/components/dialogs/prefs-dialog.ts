import { html, render } from "lit-html"
import { loadPrefs, savePrefs } from "@/utils/storage"
import type { ImageStorageMode } from "@/utils/storage"

export function applyThemeFromPrefs() {
  const prefs = loadPrefs()
  if (prefs.darkMode) {
    document.documentElement.setAttribute("data-theme", "dark")
  } else {
    document.documentElement.removeAttribute("data-theme")
  }
}

function createOverlay(): HTMLDivElement {
  const existing = document.getElementById("inb4doc-dialog-overlay")
  if (existing) existing.remove()
  const overlay = document.createElement("div")
  overlay.id = "inb4doc-dialog-overlay"
  document.body.appendChild(overlay)
  return overlay
}

export interface PrefsDialogActions {
  onStickyToolbarChange: (sticky: boolean) => void
  onImageStorageModeChange?: (mode: ImageStorageMode) => void
}

export function mountPrefsDialog(actions: PrefsDialogActions) {
  const overlay = createOverlay()
  const prefs = loadPrefs()

  const tmpl = html`
    <div class="inb4doc-prefs-box" @click=${(e: MouseEvent) => e.stopPropagation()}>
      <h3>Preferences</h3>
      <label>
        <input type="checkbox" id="inb4doc-sticky-checkbox" ?checked=${prefs.stickyToolbar} />
        Pin toolbar to top
      </label>
      <label>
        <input type="checkbox" id="inb4doc-dark-checkbox" ?checked=${prefs.darkMode} />
        Dark mode
      </label>
      <div class="prefs-section">
        <div class="prefs-section-title">Image storage</div>
        <div class="radio-group">
          <label>
            <input type="radio" name="image-mode" value="file" ?checked=${prefs.imageStorageMode === "file"} />
            Save to <code>image/</code> folder
          </label>
          <label>
            <input type="radio" name="image-mode" value="base64" ?checked=${prefs.imageStorageMode === "base64"} />
            Embed as base64 in document
          </label>
        </div>
      </div>
      <div class="inb4doc-prefs-actions">
        <button class="inb4doc-prefs-close">Close</button>
      </div>
    </div>
  `

  render(tmpl, overlay)

  const box = overlay.querySelector(".inb4doc-prefs-box")!
  const stickyCheckbox = box.querySelector("#inb4doc-sticky-checkbox") as HTMLInputElement
  const darkCheckbox = box.querySelector("#inb4doc-dark-checkbox") as HTMLInputElement
  const radioButtons = box.querySelectorAll<HTMLInputElement>('input[name="image-mode"]')

  stickyCheckbox.addEventListener("change", () => {
    prefs.stickyToolbar = stickyCheckbox.checked
    savePrefs(prefs)
    actions.onStickyToolbarChange(stickyCheckbox.checked)
  })

  darkCheckbox.addEventListener("change", () => {
    prefs.darkMode = darkCheckbox.checked
    savePrefs(prefs)
    if (prefs.darkMode) {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
  })

  radioButtons.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        prefs.imageStorageMode = radio.value as ImageStorageMode
        savePrefs(prefs)
        actions.onImageStorageModeChange?.(prefs.imageStorageMode)
      }
    })
  })

  box.querySelector(".inb4doc-prefs-close")!.addEventListener("click", () => {
    overlay.remove()
  })

  overlay.addEventListener("click", () => {
    overlay.remove()
  })
}
