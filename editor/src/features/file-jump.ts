import { appEvents, AppEvent } from "@/stores/app-events"
import { treeStore } from "@/stores/tree-store"
import { recentsStore } from "@/stores/recents-store"
import { showNotification } from "@/components/notification/notification"
import { fuzzyScore } from "@/utils/fuzzy"
import { flattenTreeOrder } from "@/utils/tree"
import { getCurrentPath } from "@/utils/url"

/**
 * "Jump to file" — Ctrl/Cmd+Shift+Space.
 *
 * A self-contained picker (no document-level listeners: it listens on its own
 * overlay and input, and closes on Escape / outside click / navigation). Recent
 * documents lead because the shortcut exists to get back to what you were
 * reading; everything else in the project follows, fuzzy-matched on the path.
 */

const MAX_RESULTS = 40
/** Keeps recent documents ahead of equally-scored matches. */
const RECENT_BONUS = 12

let overlay: HTMLDivElement | null = null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function label(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/")
  if (slash === -1) return { name: path, dir: "" }
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

/** Recent documents first, then the whole tree in explorer order. */
function orderedPaths(query: string): string[] {
  const recents = recentsStore.getRecents()
  const order = flattenTreeOrder(treeStore.getTree())

  const seen = new Set<string>()
  const unique: string[] = []
  for (const path of query ? order : [...recents, ...order]) {
    if (seen.has(path)) continue
    seen.add(path)
    unique.push(path)
  }

  if (!query) return unique.slice(0, MAX_RESULTS)

  const recentRank = new Map(recents.map((path, i) => [path, recents.length - i]))
  const scored: { path: string; score: number }[] = []
  for (const path of unique) {
    const base = fuzzyScore(query, path)
    if (base <= 0) continue
    const rank = recentRank.get(path)
    scored.push({ path, score: base + (rank ? RECENT_BONUS + rank : 0) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_RESULTS).map((s) => s.path)
}

function itemMarkup(paths: string[], active: number): string {
  return paths
    .map((path, i) => {
      const { name, dir } = label(path)
      const recent = recentsStore.getRecents().includes(path)
      return `<li class="file-jump-item${i === active ? " is-active" : ""}" role="option" aria-selected="${i === active}" data-path="${escapeHtml(path)}">
        <span class="file-jump-name">${escapeHtml(name)}</span>${dir ? `<span class="file-jump-dir">${escapeHtml(dir)}</span>` : ""}${recent ? `<span class="file-jump-recent">recent</span>` : ""}
      </li>`
    })
    .join("")
}

export function closeFileJump(): void {
  overlay?.remove()
  overlay = null
}

export function openFileJump(): void {
  closeFileJump()

  const el = document.createElement("div")
  el.className = "file-jump-overlay"
  el.innerHTML = `
    <div class="file-jump-panel" role="dialog" aria-label="Jump to file">
      <input class="file-jump-input" type="text" placeholder="Jump to file…" aria-label="File name" autocomplete="off" spellcheck="false" />
      <ul class="file-jump-list" role="listbox" aria-label="Files"></ul>
      <div class="file-jump-hint">↑↓ move · Enter open · Esc close</div>
    </div>`
  document.body.appendChild(el)
  overlay = el

  const input = el.querySelector<HTMLInputElement>(".file-jump-input")!
  const list = el.querySelector<HTMLElement>(".file-jump-list")!

  let paths = orderedPaths("")
  let active = 0

  const paint = (): void => {
    if (paths.length === 0) {
      list.innerHTML = `<li class="file-jump-empty">No matching file</li>`
      return
    }
    list.innerHTML = itemMarkup(paths, active)
    const el2 = list.querySelector<HTMLElement>(`.file-jump-item.is-active`)
    el2?.scrollIntoView({ block: "nearest" })
  }

  const setActive = (next: number): void => {
    if (paths.length === 0) return
    active = ((next % paths.length) + paths.length) % paths.length
    paint()
  }

  const choose = (): void => {
    const path = paths[active]
    if (!path) return
    closeFileJump()
    appEvents.emit(AppEvent.Navigate, { path })
  }

  input.addEventListener("input", () => {
    paths = orderedPaths(input.value)
    active = 0
    paint()
  })

  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeFileJump()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive(active + 1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive(active - 1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      choose()
    }
  })

  el.addEventListener("click", (event: Event) => {
    if (event.target === el) {
      closeFileJump()
      return
    }
    const item = (event.target as HTMLElement).closest<HTMLElement>(".file-jump-item")
    if (!item) return
    active = Number(item.dataset.index ?? Array.from(list.children).indexOf(item))
    choose()
  })

  paint()
  input.focus()
}

/**
 * Step to the next/previous document (Alt+ArrowUp/Down) — same order the
 * explorer shows, wrapping at both ends.
 */
export function navigateRelativeFile(delta: number): void {
  const order = flattenTreeOrder(treeStore.getTree())
  if (order.length === 0) return

  const current = getCurrentPath()
  let index = order.indexOf(current)
  if (index === -1 && current.endsWith(`/_index`)) index = order.indexOf(current)
  if (index === -1) {
    // The open document isn't in the list (unsaved draft, hidden folder): start
    // from whichever end the step direction came from.
    const target = delta > 0 ? order[0] : order[order.length - 1]
    if (target) appEvents.emit(AppEvent.Navigate, { path: target })
    return
  }

  const next = order[((index + delta) % order.length + order.length) % order.length]
  if (!next) return
  if (next === current) {
    showNotification("No other file to step to", { type: "info", id: "file-step" })
    return
  }
  appEvents.emit(AppEvent.Navigate, { path: next })
}
