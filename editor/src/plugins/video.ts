import { defineNodeView } from "@prosekit/core"
import type { NodeView } from "prosemirror-view"
import { editPencil } from "@/eta/icons"

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

export function parseVideoAttrs(html: string): VideoAttrs {
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

export const videoView = defineNodeView({
  name: "video",
  constructor: (node, view, getPos): NodeView => {
    const wrapper = document.createElement("div")
    wrapper.className = "video-wrapper"
    wrapper.contentEditable = "false"

    const editBtn = document.createElement("button")
    editBtn.className = "video-edit-btn"
    editBtn.title = "Edit video properties"
    editBtn.innerHTML = editPencil
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
      if (e.target === editBtn || (editBtn as HTMLElement).contains(e.target as Element)) return
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
      video.playsInline = a.playsinline
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
  },
})
