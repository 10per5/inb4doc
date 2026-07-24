import { BaseDialogController } from "./base-dialog-controller"

export class ImportZipDialogController extends BaseDialogController {
  connect() {
    this.updateButton()
  }

  toggle() {
    const replaceAll = this.element.querySelector("#replace-all-check") as HTMLInputElement | null
    const target = (arguments[0]?.target as HTMLElement)?.closest("input[type='checkbox']") as HTMLInputElement | undefined
    if (target?.dataset.type === "replace" && !target.checked && replaceAll) {
      replaceAll.checked = false
    }
    this.updateButton()
  }

  replaceAll(e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    const replaceCbs = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[data-type="replace"]')
    replaceCbs.forEach(cb => { cb.disabled = checked; cb.checked = checked })
    this.updateButton()
  }

  import() {
    const newEntries = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[data-type="new"]:checked')
    const replaceEntries = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[data-type="replace"]:checked')
    const selected: Array<{ relPath: string }> = []
    newEntries.forEach(cb => {
      selected.push({ relPath: cb.closest(".import-file-row")?.querySelector(".import-file-path")?.textContent ?? "" })
    })
    replaceEntries.forEach(cb => {
      selected.push({ relPath: cb.closest(".import-file-row")?.querySelector(".import-file-path")?.textContent ?? "" })
    })
    this.confirm({ selected })
  }

  private updateButton() {
    const importBtn = this.element.querySelector("#import-btn") as HTMLButtonElement | null
    const replaceAll = this.element.querySelector("#replace-all-check") as HTMLInputElement | null
    if (!importBtn) return

    const checked = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[type="checkbox"]:checked')
    const hasSelection = checked.length > 0 || (replaceAll?.checked ?? false)
    importBtn.disabled = !hasSelection
    importBtn.textContent = replaceAll?.checked ? "Import all (forced)" : "Import"
  }
}
