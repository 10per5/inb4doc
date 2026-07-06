import type { EditorService } from "@/services/editor-service"

let editorService: EditorService | null = null

let bar: HTMLDivElement | null = null
let input: HTMLInputElement | null = null
let matchLabel: HTMLSpanElement | null = null

let currentQuery = ""
let currentIdx = -1  // -1 = no match navigated to yet
let totalMatches = 0

// source-mode positions cached from an indexOf sweep over textarea.value
let srcPositions: { start: number; end: number }[] = []

// ── registered by AppOrchestrator at startup ──

export function setEditorService(es: EditorService): void {
  editorService = es
}

// ── public API exposed on predocUI ──

export function openFind(): void {
  if (bar) { close(); return }

  bar = document.createElement("div")
  bar.id = "prdc-find-bar"
  bar.style.cssText = [
    "position:fixed", "top:0", "left:50%",
    "transform:translateX(-50%)", "z-index:100000",
    "background:#1e1e1e", "padding:6px 10px",
    "border-radius:0 0 8px 8px",
    "box-shadow:0 4px 16px rgba(0,0,0,.45)",
    "display:flex", "gap:8px", "align-items:center",
  ].join(";")

  input = document.createElement("input")
  input.type = "text"
  input.placeholder = "Find\u2026"
  input.style.cssText = [
    "background:#333", "color:#eee",
    "border:1px solid #555", "border-radius:4px",
    "padding:4px 8px", "font:13px system-ui,sans-serif",
    "outline:none", "width:200px",
  ].join(";")

  matchLabel = document.createElement("span")
  matchLabel.style.cssText = "color:#888;font:12px system-ui,sans-serif;min-width:48px;text-align:center"

  const closeBtn = document.createElement("span")
  closeBtn.textContent = "\u2715"
  closeBtn.style.cssText = "cursor:pointer;color:#888;font:14px system-ui,sans-serif;padding:2px 6px"
  closeBtn.addEventListener("click", close)

  input.addEventListener("input", () => search(input!.value))
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return }
    if (e.key === "Enter") {
      e.preventDefault()
      if (e.shiftKey) { prevMatch(); return }
      nextMatch()
    }
  })

  bar.append(input, matchLabel, closeBtn)
  document.body.appendChild(bar)
  input.focus()
  input.select()
}

export function findNext(): void {
  if (bar && input) {
    if (input.value.trim() !== currentQuery) search(input.value)
    nextMatch()
    return
  }
  openFind()
}

export function findPrev(): void {
  if (bar && input) {
    if (input.value.trim() !== currentQuery) search(input.value)
    prevMatch()
    return
  }
  openFind()
}

// ── internal ──

function close(): void {
  srcPositions = []
  currentQuery = ""
  currentIdx = -1
  totalMatches = 0
  bar?.remove()
  bar = null
  input = null
  matchLabel = null
  const pm = document.querySelector<HTMLElement>(".ProseMirror")
  pm?.focus()
}

function updateCounter(): void {
  if (!matchLabel) return
  if (totalMatches === 0) {
    matchLabel.textContent = currentQuery ? "0 matches" : ""
    matchLabel.style.color = "#c44"
    return
  }
  if (currentIdx < 0) {
    matchLabel.textContent = `${totalMatches} matches`
    matchLabel.style.color = "#888"
    return
  }
  matchLabel.textContent = `${currentIdx + 1} / ${totalMatches}`
  matchLabel.style.color = "#888"
}

function search(q: string): void {
  const trimmed = q.trim()
  if (!trimmed) {
    currentQuery = ""
    currentIdx = -1
    totalMatches = 0
    srcPositions = []
    updateCounter()
    return
  }
  currentQuery = trimmed
  currentIdx = -1

  if (editorService?.isSourceMode()) {
    searchSource(trimmed)
  } else {
    searchProseMirror(trimmed)
  }
  updateCounter()
}

function countInProsemirror(q: string): number {
  const pm = document.querySelector(".ProseMirror")
  if (!pm) return 0
  const lower = q.toLowerCase()
  let count = 0
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let tn: Text | null
  while ((tn = walker.nextNode() as Text | null)) {
    const text = tn.textContent || ""
    let idx = 0
    while ((idx = text.toLowerCase().indexOf(lower, idx)) >= 0) {
      count++
      idx += q.length
    }
  }
  return count
}

function searchProseMirror(q: string): void {
  totalMatches = countInProsemirror(q)
}

function searchSource(q: string): void {
  const ta = document.querySelector<HTMLTextAreaElement>("#source-editor textarea")
  if (!ta) { totalMatches = 0; return }

  const text = ta.value
  const lower = q.toLowerCase()
  srcPositions = []
  let idx = 0
  while ((idx = text.toLowerCase().indexOf(lower, idx)) >= 0) {
    srcPositions.push({ start: idx, end: idx + q.length })
    idx += q.length
  }

  totalMatches = srcPositions.length
}

function nextMatch(): void {
  if (totalMatches === 0) return
  if (currentIdx < 0) currentIdx = 0
  else currentIdx = (currentIdx + 1) % totalMatches
  applyMatch(currentIdx)
  updateCounter()
}

function prevMatch(): void {
  if (totalMatches === 0) return
  if (currentIdx < 0) currentIdx = totalMatches - 1
  else currentIdx = (currentIdx - 1 + totalMatches) % totalMatches
  applyMatch(currentIdx)
  updateCounter()
}

function applyMatch(idx: number): void {
  if (!currentQuery) return

  if (editorService?.isSourceMode()) {
    showSourceMatch(idx)
  } else {
    editorService?.scrollToText(currentQuery, idx)
  }
  // scrollToText focuses ProseMirror — restore focus to find input
  setTimeout(() => input?.focus(), 0)
}

function showSourceMatch(idx: number): void {
  const ta = document.querySelector<HTMLTextAreaElement>("#source-editor textarea")
  if (!ta || idx >= srcPositions.length) return

  const { start, end } = srcPositions[idx]
  ta.focus()
  ta.setSelectionRange(start, end)

  const lineHeight = 20
  const textBefore = ta.value.slice(0, start)
  const lineNum = textBefore.split("\n").length - 1
  const visibleLines = Math.max(1, ta.clientHeight / lineHeight)
  const targetScroll = Math.max(0, (lineNum - visibleLines / 2) * lineHeight)
  ta.scrollTop = targetScroll
}
