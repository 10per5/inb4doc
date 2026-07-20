import type { ViewController, ViewType } from "@/controllers/view-controller"

export interface EditorViewOptions {
  sourceMode: () => boolean
  milkdownEl: HTMLElement
  sourceEl: HTMLElement
  editorArea: HTMLElement
}

export function registerEditorView(
  registerFn: ViewController["register"],
  opts: EditorViewOptions,
) {
  registerFn("editor", {
    activate: () => {
      opts.milkdownEl.style.display = ""
      opts.sourceEl.style.display = opts.sourceMode() ? "" : "none"
      const du = opts.editorArea.querySelector(".disk-usage-wrapper")
      if (du) du.remove()
    },
    deactivate: () => {
      opts.milkdownEl.style.display = "none"
      opts.sourceEl.style.display = "none"
    },
  })
}
