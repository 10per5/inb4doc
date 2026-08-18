import type { EditorView } from "prosemirror-view"

export interface MenuAPI {
  show: (pos: number) => void
  hide: () => void
}

const store = new WeakMap<EditorView, MenuAPI>()

export const menuAPI = {
  key: "menuAPICtx" as const,
  get(view: EditorView): MenuAPI {
    return store.get(view) ?? { show: () => {}, hide: () => {} }
  },
  set(view: EditorView, api: MenuAPI) {
    store.set(view, api)
  },
}
