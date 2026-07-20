import { BaseDialogController } from "./base-dialog-controller"

export class ImportZipDialogController extends BaseDialogController {
  toggle() {
    const importBtn = this.element.querySelector("#import-btn") as HTMLButtonElement
    const checked = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[type="checkbox"]:checked')
    importBtn.disabled = checked.length === 0

    const replaceAll = this.element.querySelector("#replace-all-check") as HTMLInputElement
    const target = (arguments[0]?.target as HTMLElement)?.closest("input[type='checkbox']") as HTMLInputElement | undefined
    if (target?.dataset.type === "replace" && !target.checked) {
      replaceAll.checked = false
    }
  }

  replaceAll(e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    const replaceCbs = this.element.querySelectorAll<HTMLInputElement>('.import-file-row input[data-type="replace"]')
    replaceCbs.forEach(cb => { cb.checked = checked })
    this.toggle()
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
}
