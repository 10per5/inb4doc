import { $remark, $nodeSchema, $view } from "@milkdown/utils"
import type { Node } from "@milkdown/transformer"
import type { NodeView } from "@milkdown/kit/prose/view"
import { visitParents } from "unist-util-visit-parents"

export interface VideoAttrs {
  src: string
  poster: string
  controls: boolean
  loop: boolean
  muted: boolean
  autoplay: boolean
  playsinline: boolean
  width: string
  height: string
}

export const defaultVideoAttrs: VideoAttrs = {
  src: "",
  poster: "",
  controls: true,
  loop: false,
  muted: false,
  autoplay: false,
  playsinline: false,
  width: "",
  height: "",
}

function parseVideoAttrs(html: string): VideoAttrs {
  const openingTag = html.match(/<video\s[^>]*>/)?.[0] || ""
  const srcVideo = openingTag.match(/src\s*=\s*"([^"]+)"/)?.[1] || ""
  const srcSource = html.match(/<source\s[^>]*src\s*=\s*"([^"]+)"/)?.[1] || ""

  const getBool = (attr: string, def: boolean): boolean => {
    const re = new RegExp(`${attr}\\s*=\\s*"(true|false)"`, "i")
    const m = openingTag.match(re)
    if (m) return m[1] === "true"
    return new RegExp(`\\b${attr}\\b`, "i").test(openingTag) || def
  }

  return {
    src: srcSource || srcVideo,
    poster: openingTag.match(/poster\s*=\s*"([^"]+)"/)?.[1] || "",
    controls: getBool("controls", true),
    loop: getBool("loop", false),
    muted: getBool("muted", false),
    autoplay: getBool("autoplay", false),
    playsinline: getBool("playsinline", false),
    width: openingTag.match(/width\s*=\s*"([^"]+)"/)?.[1] || "",
    height: openingTag.match(/height\s*=\s*"([^"]+)"/)?.[1] || "",
  }
}

function visitVideo(ast: Node) {
  visitParents(ast, "html", (node: Node & { value?: string }, parents: Node[]) => {
    if (!node.value || typeof node.value !== "string") return
    const trimmed = node.value.trim()
    if (!trimmed.startsWith("<video")) return

    const parent = parents[parents.length - 1] as Node & { children: Node[] }
    if (!parent) return

    const videoNode = { type: "video", ...parseVideoAttrs(trimmed) } as any

    if (parent.type === "paragraph") {
      if (parent.children.length !== 1) return
      const grandParent = parents.length > 1 ? parents[parents.length - 2] as Node & { children: Node[] } : null
      if (!grandParent) return
      const pIndex = grandParent.children.indexOf(parent)
      if (pIndex === -1) return
      grandParent.children.splice(pIndex, 1, videoNode)
      return
    }

    parent.children.splice(indexOfNode(parent, node), 1, videoNode)
  })
}

function indexOfNode(parent: Node & { children: Node[] }, node: Node): number {
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i] === node) return i
  }
  return -1
}

export const videoRemarkPlugin = $remark("remark-video", () => () => visitVideo)

export const videoSchema = $nodeSchema("video", () => ({
  group: "block",
  selectable: true,
  draggable: true,
  isolating: true,
  marks: "",
  atom: true,
  priority: 200,
  attrs: {
    src: { default: "", validate: "string" },
    poster: { default: "", validate: "string" },
    controls: { default: true },
    loop: { default: false },
    muted: { default: false },
    autoplay: { default: false },
    playsinline: { default: false },
    width: { default: "", validate: "string" },
    height: { default: "", validate: "string" },
  },
  parseDOM: [
    {
      tag: "div.video-wrapper",
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        const video = el.querySelector("video")
        return {
          src: video?.getAttribute("src") || el.getAttribute("data-src") || "",
          poster: video?.getAttribute("poster") || "",
          controls: video?.hasAttribute("controls") ?? true,
          loop: video?.hasAttribute("loop") ?? false,
          muted: video?.hasAttribute("muted") ?? false,
          autoplay: video?.hasAttribute("autoplay") ?? false,
          playsinline: video?.hasAttribute("playsinline") ?? false,
          width: video?.getAttribute("width") || "",
          height: video?.getAttribute("height") || "",
        }
      },
    },
    {
      tag: "video",
      getAttrs: (dom) => {
        const el = dom as HTMLVideoElement
        const source = el.querySelector("source")
        return {
          src: source?.getAttribute("src") || el.getAttribute("src") || "",
          poster: el.getAttribute("poster") || "",
          controls: el.hasAttribute("controls"),
          loop: el.hasAttribute("loop"),
          muted: el.hasAttribute("muted"),
          autoplay: el.hasAttribute("autoplay"),
          playsinline: el.hasAttribute("playsinline"),
          width: el.getAttribute("width") || "",
          height: el.getAttribute("height") || "",
        }
      },
    },
  ],
  toDOM: (node) => {
    const a = node.attrs
    const videoAttrs: Record<string, string> = {}
    if (a.poster) videoAttrs.poster = a.poster
    if (a.width) videoAttrs.width = a.width
    if (a.height) videoAttrs.height = a.height
    if (a.controls) videoAttrs.controls = ""
    if (a.loop) videoAttrs.loop = ""
    if (a.muted) videoAttrs.muted = ""
    if (a.autoplay) videoAttrs.autoplay = ""
    if (a.playsinline) videoAttrs.playsinline = ""
    const children: any[] = []
    if (a.src) {
      videoAttrs.src = a.src
    }
    return ["div", { class: "video-wrapper", "data-type": "video" }, ["video", videoAttrs]]
  },
  parseMarkdown: {
    match: ({ type }) => type === "video",
    runner: (state, node, proseType) => {
      const n = node as any
      state.addNode(proseType, {
        src: n.src || "",
        poster: n.poster || "",
        controls: n.controls ?? true,
        loop: n.loop ?? false,
        muted: n.muted ?? false,
        autoplay: n.autoplay ?? false,
        playsinline: n.playsinline ?? false,
        width: n.width || "",
        height: n.height || "",
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "video",
    runner: (state, node) => {
      const a = node.attrs
      let html = "<video"
      if (a.width) html += ` width="${a.width}"`
      if (a.height) html += ` height="${a.height}"`
      if (a.controls) html += ` controls`
      if (a.loop) html += ` loop`
      if (a.muted) html += ` muted`
      if (a.autoplay) html += ` autoplay`
      if (a.playsinline) html += ` playsinline`
      if (a.poster) html += ` poster="${a.poster}"`
      if (a.src) {
        html += ' src="' + a.src + '">'
      } else {
        html += ">"
      }
      html += "</video>"
      state.addNode("html", undefined, html)
    },
  },
}))

function dispatchEditEvent(view: any, getPos: () => number | undefined) {
  const pos = getPos()
  if (pos == null) return
  const currentAttrs = view.state.doc.nodeAt(pos)?.attrs
  if (!currentAttrs) return
  view.dom.dispatchEvent(new CustomEvent("inb4doc:edit-video", {
    bubbles: true,
    detail: { pos, attrs: { ...currentAttrs } },
  }))
}

export const videoView = $view(videoSchema.node, () => {
  return (node, view, getPos, decorations): NodeView => {
    const wrapper = document.createElement("div")
    wrapper.className = "video-wrapper"
    wrapper.contentEditable = "false"

    const editBtn = document.createElement("button")
    editBtn.className = "video-edit-btn"
    editBtn.title = "Edit video properties"
    editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M14.06 9.02L14.98 9.94L5.92 19H5V18.08L14.06 9.02ZM17.66 3C17.41 3 17.15 3.1 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C18.17 3.09 17.92 3 17.66 3Z"/></svg>`
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    editBtn.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      dispatchEditEvent(view, getPos)
    })

    wrapper.addEventListener("click", (e) => {
      if (e.target === editBtn || editBtn.contains(e.target as Node)) return
      if ((e.target as HTMLElement).closest("video")) return
      e.preventDefault()
      dispatchEditEvent(view, getPos)
    })

    const placeholder = document.createElement("div")
    placeholder.className = "video-placeholder"
    placeholder.innerHTML = '<span class="video-placeholder-icon">&#x25B6;</span><span>Click to add video URL</span>'
    placeholder.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      dispatchEditEvent(view, getPos)
    })

    const video = document.createElement("video")
    video.style.width = "100%"
    video.style.maxHeight = "400px"
    video.draggable = true

    function sync(node: any) {
      const a = node.attrs
      video.poster = a.poster || ""
      video.controls = a.controls
      video.loop = a.loop
      video.muted = a.muted
      video.autoplay = a.autoplay
      video.playsinline = a.playsinline
      if (a.width) video.style.width = a.width + (String(a.width).match(/^\d+$/) ? "px" : "")
      if (a.height) video.style.maxHeight = a.height + (String(a.height).match(/^\d+$/) ? "px" : "")
      while (video.firstChild) video.removeChild(video.firstChild)
      if (a.src) {
        const source = document.createElement("source")
        source.src = a.src
        video.appendChild(source)
      }
      video.style.display = a.src ? "" : "none"
      placeholder.style.display = a.src ? "none" : ""
    }

    sync(node)

    wrapper.appendChild(placeholder)
    wrapper.appendChild(video)
    wrapper.appendChild(editBtn)

    return {
      dom: wrapper,
      selectNode: () => wrapper.classList.add("selected"),
      deselectNode: () => wrapper.classList.remove("selected"),
      update: (newNode) => {
        if (newNode.type.name !== "video") return false
        sync(newNode)
        return true
      },
      destroy: () => wrapper.remove(),
      ignoreMutation: () => true,
    }
  }
})
