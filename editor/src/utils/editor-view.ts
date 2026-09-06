import type { ViewService, ViewType } from "@/services/view-service"

export interface EditorViewOptions {
  sourceMode: () => boolean
  inb4docEl: HTMLElement
  sourceEl: HTMLElement
  editorArea: HTMLElement
}

export function registerEditorView(
  registerFn: ViewService["register"],
  opts: EditorViewOptions,
) {
  registerFn("editor", {
    activate: () => {
      opts.inb4docEl.style.display = ""
      opts.sourceEl.style.display = opts.sourceMode() ? "" : "none"
    },
    deactivate: () => {
      opts.inb4docEl.style.display = "none"
      opts.sourceEl.style.display = "none"
    },
    focus: () => {
      const pm = opts.inb4docEl.querySelector<HTMLElement>(".ProseMirror");
      (pm ?? opts.inb4docEl).focus();
    },
  })
}
