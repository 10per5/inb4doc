import type { ViewController, ViewType } from "@/services/view-controller"

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
    },
    deactivate: () => {
      opts.milkdownEl.style.display = "none"
      opts.sourceEl.style.display = "none"
    },
    focus: () => {
      const pm = opts.milkdownEl.querySelector<HTMLElement>(".ProseMirror");
      (pm ?? opts.milkdownEl).focus();
    },
  })
}
