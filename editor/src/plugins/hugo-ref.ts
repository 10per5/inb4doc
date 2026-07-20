import { $node } from "@milkdown/utils"
import type { EditorView } from "@milkdown/kit/prose/view"
import { openHugoRefDialog } from "@/components/dialogs/hugo-ref-dialog"

export const hugoRefSchema = $node("hugoRef", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    path: { default: "" },
    title: { default: "" },
  },
  parseDOM: [
    {
      tag: "span[data-hugo-ref]",
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          path: el.getAttribute("data-hugo-ref") || "",
          title: el.getAttribute("data-title") || "",
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-hugo-ref": node.attrs.path,
      "data-title": node.attrs.title,
      class: "hugo-ref-link",
    },
    node.attrs.title,
  ],
  parseMarkdown: {
    match: ({ type, url }) =>
      type === "link" &&
      typeof url === "string" &&
      /^\{\{%\s*ref\s/.test(url),
    runner: (state, node, proseType) => {
      const url = node.url as string
      const pathMatch = url.match(/ref\s+path="([^"]+)"/)
      const path = pathMatch ? pathMatch[1] : url
      const title = (node.children?.[0] as any)?.value || ""
      state.addNode(proseType, { path, title })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "hugoRef",
    runner: (state, node) => {
      state.addNode(
        "text",
        undefined,
        `[${node.attrs.title}](<{{% ref path="${node.attrs.path}" %}}>)`,
      )
    },
  },
}))

export function initHugoRefClicks(view: EditorView) {
  const handler = (e: Event) => {
    const el = (e.target as HTMLElement).closest("[data-hugo-ref]") as HTMLElement | null
    if (!el) return
    e.preventDefault()
    const pos = view.posAtDOM(el, 0)
    if (pos != null) {
      openHugoRefDialog(view, pos)
    }
  }
  view.dom.addEventListener("click", handler)
}
