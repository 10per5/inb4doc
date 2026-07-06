import { $remark, $nodeSchema } from "@milkdown/utils"

function htmlValue(node: any): string | null {
  if (node.type === "html" && typeof node.value === "string") return node.value.trim()
  if (node.type === "paragraph" && node.children?.[0]?.type === "html") return node.children[0].value.trim()
  return null
}

function walkDivCenters(tree: any) {
  const children = tree.children
  if (!children) return

  for (let i = 0; i < children.length; i++) {
    const openVal = htmlValue(children[i])
    if (!openVal) continue
    const openMatch = openVal.match(/^<div\s+align\s*=\s*"center"\s*>/i)
    if (!openMatch) continue

    const afterOpen = openVal.slice(openMatch[0].length).trim()
    const closeInSame = afterOpen.match(/<\/div>/i)
    if (closeInSame) {
      const inner = afterOpen.slice(0, closeInSame.index!).trim()
      const afterClose = afterOpen.slice(closeInSame.index! + 7).trim()
      const content = inner ? [{ type: "html", value: inner }] : []
      children.splice(i, 1, { type: "divCenter", children: content })
      if (afterClose) children.splice(i + 1, 0, { type: "html", value: afterClose })
      continue
    }

    let closeIdx = -1
    for (let j = i + 1; j < children.length; j++) {
      const cv = htmlValue(children[j])
      if (cv && cv.match(/^<\/div>\s*$/i)) { closeIdx = j; break }
    }
    if (closeIdx === -1) continue

    const content: any[] = []
    if (afterOpen) content.push({ type: "html", value: afterOpen })
    for (let k = i + 1; k < closeIdx; k++) content.push(children[k])

    children.splice(i, closeIdx - i + 1, { type: "divCenter", children: content })
  }
}

export const divCenterRemarkPlugin = $remark("div-center-remark", () => () => (tree: any) => {
  walkDivCenters(tree)
})

export const divCenterSchema = $nodeSchema("divCenter", () => ({
  group: "block",
  content: "block+",
  defining: true,
  marks: "",
  attrs: {},
  parseDOM: [{ tag: "div[align=center]" }],
  toDOM: () => ["div", { align: "center", "data-type": "div-center" }, 0],
  parseMarkdown: {
    match: ({ type }) => type === "divCenter",
    runner: (state, node, proseType) => {
      state.openNode(proseType).next(node.children).closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "divCenter",
    runner: (state, node) => {
      state.addNode("html", undefined, '<div align="center">')
      state.next(node.content)
      state.addNode("html", undefined, "</div>")
    },
  },
}))
