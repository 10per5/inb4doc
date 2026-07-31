import { x } from "@/eta/icons"
import type { MetaPanelData } from "@/entities/Frontmatter"

/**
 * MetaPanelUI — imperative helpers for the meta panel's dynamic extra-field
 * rows. The panel's static structure lives in the paired eta template; this
 * class owns the inputs and (de)serializes the panel's state to MetaPanelData.
 */
export class MetaPanelUI {
  private titleInput: HTMLInputElement
  private weightInput: HTMLInputElement
  private extraContainer: HTMLElement

  constructor(container: HTMLElement, private onNotify: () => void) {
    this.titleInput = container.querySelector(".meta-title") as HTMLInputElement
    this.weightInput = container.querySelector(".meta-weight") as HTMLInputElement
    this.extraContainer = container.querySelector(".meta-extra") as HTMLElement
    this.titleInput.addEventListener("input", this.onNotify)
    this.weightInput.addEventListener("input", this.onNotify)
  }

  update(data: MetaPanelData): void {
    this.titleInput.value = data.title || ""
    this.weightInput.value = data.weight != null ? String(data.weight) : ""

    const extras: Record<string, string> = {}
    for (const [key, val] of Object.entries(data)) {
      if (key !== "title" && key !== "weight" && val !== undefined) {
        extras[key] = String(val)
      }
    }
    this.renderExtra(extras)
  }

  collect(): MetaPanelData {
    const data: MetaPanelData = { title: this.titleInput.value }
    const w = parseInt(this.weightInput.value)
    if (!isNaN(w)) data.weight = w

    this.extraContainer.querySelectorAll(".meta-extra-row").forEach((row) => {
      const keyInput = row.querySelector(".meta-extra-key") as HTMLInputElement
      const valInput = row.querySelector(".meta-extra-val") as HTMLInputElement
      if (keyInput.value) data[keyInput.value] = valInput.value
    })

    return data
  }

  addRow(key = "", value = "", focusFirst = false): void {
    const row = document.createElement("div")
    row.className = "meta-extra-row"
    row.innerHTML = `
      <input class="meta-extra-key" value="${key}" placeholder="key" />
      <input class="meta-extra-val" value="${value}" placeholder="value" />
      <button class="meta-extra-remove">${x}</button>
    `
    row.querySelector(".meta-extra-remove")!.addEventListener("click", () => {
      row.remove()
      this.onNotify()
    })
    ;(row.querySelector(".meta-extra-key") as HTMLInputElement).addEventListener("input", this.onNotify)
    ;(row.querySelector(".meta-extra-val") as HTMLInputElement).addEventListener("input", this.onNotify)
    this.extraContainer.appendChild(row)
    if (focusFirst) row.querySelector("input")!.focus()
  }

  private renderExtra(extra: Record<string, string>): void {
    this.extraContainer.innerHTML = ""
    for (const [key, val] of Object.entries(extra)) {
      this.addRow(key, val)
    }
  }
}
