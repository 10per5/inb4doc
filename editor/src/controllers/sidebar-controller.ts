import { Controller } from "@hotwired/stimulus"
import { editorSelfBase } from "@/config"
import {
  type TreeNode,
  type SidebarActions,
  type RenderContext,
  buildPendingSets,
  renderItems,
  applyResults,
  showMenu,
  closeMenu,
  computeLiveUrl,
  liveIcon,
} from "@/components/panels/sidebar"
import type { PendingOp } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import {
  collectPagePaths,
  searchContent,
} from "@/features/search/sidebar-search"
import { confirmDialog } from "@/components/dialogs/dialog"
import { showNotification } from "@/components/notification/notification"
import { appEvents, AppEvent } from "@/stores/app-events"

export default class extends Controller {
  static targets = ["inner", "search", "searchWrapper", "newPageBtn", "providerLabel"]

  declare readonly innerTarget: HTMLElement
  declare readonly searchTarget: HTMLInputElement
  declare readonly searchWrapperTarget: HTMLElement
  declare readonly newPageBtnTarget: HTMLElement
  declare readonly providerLabelTarget: HTMLElement

  private actions: SidebarActions | null = null
  private tree: TreeNode = {}
  private collapsedSections = new Map<string, boolean>()
  private searchTimer: ReturnType<typeof setTimeout> | null = null
  private currentQuery = ""
  private allPaths: string[] = []
  private unsubs: (() => void)[] = []
  private itemByPath = new Map<string, HTMLElement>()
  private prevDirty = new Set<string>()

  connect() {
    this.unsubs.push(
      appEvents.on(AppEvent.DirtyChanged, ({ dirtyPaths }) => {
        this.updateDirtyIndicators(dirtyPaths)
      }),
    )
  }

  disconnect() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.unsubs.forEach(u => u())
    this.unsubs = []
    closeMenu()
  }

  load(opts: {
    tree: TreeNode
    current: string
    actions: SidebarActions
    providerIcon?: string
    providerLabel?: string
    providerType?: ProviderType
    pendingOps?: PendingOp[]
    dirtyPaths?: string[]
    rawTree?: TreeNode
  }) {
    this.actions = opts.actions
    this.tree = opts.tree

    const treeEmpty = Object.keys(opts.tree).length === 0

    this.providerLabelTarget.textContent = `${opts.providerIcon ?? ""} ${opts.providerLabel ?? "No provider"}`

    if (treeEmpty) {
      this.searchWrapperTarget.style.display = "none"
    } else {
      this.searchWrapperTarget.style.display = ""
    }

    const ctx: RenderContext = {
      current: opts.current,
      basePath: editorSelfBase,
      collapsedSections: this.collapsedSections,
      rawSubtree: opts.rawTree,
      pendingSets: buildPendingSets(opts.pendingOps, opts.dirtyPaths),
      pendingOps: opts.pendingOps,
    }

    this.allPaths = treeEmpty ? [] : collectPagePaths(opts.tree)

    const prevScroll = this.innerTarget.scrollTop
    this.innerTarget.innerHTML = treeEmpty
      ? `<div class="sidebar-empty">No files</div>`
      : renderItems(opts.tree, "", 0, ctx)
    this.innerTarget.scrollTop = prevScroll

    this.itemByPath.clear()
    if (!treeEmpty) {
      for (const el of this.innerTarget.querySelectorAll<HTMLElement>(".nav-item")) {
        const p = el.getAttribute("data-nav-path")
        if (p) this.itemByPath.set(p, el)
      }
    }

    this.renderLiveUrl(opts.providerType, opts.current)
    this.resetSearch()
  }

  private renderLiveUrl(providerType?: ProviderType, current?: string) {
    const liveUrl = computeLiveUrl(providerType, current)
    const footer = this.innerTarget.parentElement?.querySelector(".sidebar-footer")
    if (!footer) return
    const existing = footer.querySelector(".nav-live-link") as HTMLElement | null
    if (liveUrl) {
      if (existing) {
        existing.setAttribute("href", liveUrl)
      } else {
        const link = document.createElement("a")
        link.href = liveUrl
        link.rel = "noopener noreferrer"
        link.className = "nav-live-link"
        link.innerHTML = `${liveIcon}<span>View live version</span>`
        footer.appendChild(link)
      }
    } else if (existing) {
      existing.remove()
    }
  }

  private resetSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.currentQuery = ""
    this.searchTarget.value = ""
    this.searchTarget.parentElement?.classList.remove("has-value")
  }

  // --- Stimulus action methods ---

  onChangeProvider() {
    this.actions?.onChangeProvider()
  }

  onSearchInput() {
    const q = this.searchTarget.value
    this.updateSearchResults(q)
    this.searchTarget.parentElement!.classList.toggle("has-value", !!q)
  }

  onSearchClear() {
    this.clearSearch()
  }

  onNewPage() {
    this.actions?.onNewItem("docs")
  }

  onNavigate(event: Event) {
    event.preventDefault()
    const navLink = (event.currentTarget as HTMLElement).closest(".nav-link") as HTMLAnchorElement
    if (!navLink) return
    const linkPath = navLink.getAttribute("data-nav-path")
    const itemPath = navLink.closest(".nav-item")?.getAttribute("data-nav-path")
    const path = linkPath || itemPath
    if (path) this.actions?.onNavigate(path)
  }

  onShowMenu(event: Event) {
    event.stopPropagation()
    const target = event.target as HTMLElement
    const navMore = target.closest(".nav-more") as HTMLElement
    if (!navMore) return
    const navItem = navMore.closest(".nav-item")
    const navSection = navMore.closest(".nav-section")
    const path = (navItem || navSection)?.getAttribute("data-nav-path") || ""
    const isFolder = "isFolder" in navMore.dataset
    if (this.actions) showMenu(navMore, path, this.actions, isFolder)
  }

  onToggleSection(event: Event) {
    event.stopPropagation()
    const target = event.target as HTMLElement
    const sectionToggle = target.closest(".nav-section-toggle") as HTMLElement
    const sectionTitle = target.closest(".nav-section-title") as HTMLElement
    const anchor = sectionToggle || sectionTitle
    if (!anchor) return
    const section = anchor.closest(".nav-section") as HTMLElement
    if (!section) return
    const path = section.getAttribute("data-nav-path") || ""
    const wasCollapsed = this.collapsedSections.get(path) ?? false
    this.collapsedSections.set(path, !wasCollapsed)
    section.classList.toggle("collapsed")
  }

  // --- Keyboard navigation ---

  onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape" && e.target === this.searchTarget) {
        this.clearSearch()
      }
      return
    }

    const items = this.getVisibleItems()
    if (items.length === 0) return

    const current = document.activeElement as HTMLElement
    let idx = items.indexOf(current as HTMLAnchorElement)

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (idx < 0) idx = -1
        items[(idx + 1) % items.length].focus()
        break
      case "ArrowUp":
        e.preventDefault()
        if (idx < 0) idx = 0
        items[(idx - 1 + items.length) % items.length].focus()
        break
      case "Home":
        e.preventDefault()
        items[0].focus()
        break
      case "End":
        e.preventDefault()
        items[items.length - 1].focus()
        break
      case "Enter":
        if (idx >= 0) { e.preventDefault(); items[idx].click(); }
        break
    }
  }

  private getVisibleItems(): HTMLAnchorElement[] {
    const items = this.innerTarget.querySelectorAll<HTMLAnchorElement>(".nav-link")
    return Array.from(items).filter(
      (a) => a.offsetParent !== null && (a.closest(".nav-item") as HTMLElement | null)?.style.display !== "none"
    )
  }

  // --- Search ---

  private clearSearch() {
    this.searchTarget.value = ""
    this.updateSearchResults("")
    this.searchTarget.parentElement!.classList.remove("has-value")
    this.searchTarget.focus()
  }

  private updateSearchResults(query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer)

    const q = query.toLowerCase().trim()
    this.currentQuery = q
    if (!q) {
      applyResults({
        container: this.innerTarget,
        q: "",
        filenameMatches: new Set(),
        contentMatches: new Map(),
        currentQuery: "",
        actions: this.actions!,
      })
      return
    }

    const items = this.innerTarget.querySelectorAll<HTMLElement>(".nav-item")
    const filenameMatches = new Set<string>()
    for (const item of items) {
      const path = item.getAttribute("data-nav-path") || ""
      const label =
        item.querySelector(".nav-link")?.textContent?.toLowerCase() || ""
      if (label.includes(q)) filenameMatches.add(path)
    }
    applyResults({
      container: this.innerTarget,
      q,
      filenameMatches,
      contentMatches: new Map(),
      currentQuery: q,
      actions: this.actions!,
    })

    this.searchTimer = setTimeout(async () => {
      const matches = await searchContent(this.allPaths, q)
      const contentMatches = new Map<string, string[]>()
      for (const m of matches) {
        contentMatches.set(m.path, m.snippets)
      }
      applyResults({
        container: this.innerTarget,
        q,
        filenameMatches,
        contentMatches,
        currentQuery: q,
        actions: this.actions!,
      })
    }, 200)
  }

  // --- Dirty reactivity ---

  private updateDirtyIndicators(dirtyPaths: string[]): void {
    const dirtySet = new Set(dirtyPaths)
    // Only update items whose dirty state changed
    for (const path of this.prevDirty) {
      if (!dirtySet.has(path)) this.setDirty(path, false)
    }
    for (const path of dirtySet) {
      if (!this.prevDirty.has(path)) this.setDirty(path, true)
    }
    this.prevDirty = dirtySet
  }

  private setDirty(path: string, dirty: boolean): void {
    const item = this.itemByPath.get(path)
    if (!item) return
    item.classList.toggle("pending-unsaved", dirty)
    const link = item.querySelector<HTMLElement>(".nav-link")
    if (link) link.classList.toggle("pending-unsaved", dirty)
    const badge = item.querySelector(".pending-badge.pending-badge-unsaved")
    if (dirty && !badge) {
      const span = document.createElement("span")
      span.className = "pending-badge pending-badge-unsaved"
      span.textContent = "unsaved"
      link?.appendChild(span)
    } else if (!dirty && badge) {
      badge.remove()
    }
  }

  // --- Drag and drop ---

  onDragStart(e: DragEvent) {
    const target = e.target as HTMLElement
    const navItem = target.closest(".nav-item")
    const navSection = target.closest(".nav-section")

    if (navItem) {
      const pagePath = navItem.getAttribute("data-nav-path")
      e.dataTransfer?.setData("text/plain", "file:" + pagePath)
    } else if (navSection && target === navSection) {
      const path = navSection.getAttribute("data-nav-path")
      e.dataTransfer?.setData("text/plain", "dir:" + path)
    }
  }

  onDragEnter(e: DragEvent) {
    const target = e.target as HTMLElement
    const navSection = target.closest(".nav-section")
    if (navSection) {
      e.stopPropagation()
      e.preventDefault()
      navSection.classList.add("drag-over")
    }
  }

  onDragLeave(e: DragEvent) {
    const target = e.target as HTMLElement
    const navSection = target.closest(".nav-section")
    if (navSection) {
      e.stopPropagation()
      const rt = e.relatedTarget
      if (rt !== null && !navSection.contains(rt as Node)) {
        navSection.classList.remove("drag-over")
      }
    }
  }

  onDragOver(e: DragEvent) {
    const target = (e.target as HTMLElement)
    if (target.closest(".nav-section")) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  onDragEnd() {
    this.innerTarget.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"))
  }

  async onDrop(e: DragEvent) {
    const target = e.target as HTMLElement
    const navSection = target.closest(".nav-section")
    if (!navSection) return

    e.stopPropagation()
    e.preventDefault()
    navSection.classList.remove("drag-over")

    const from = e.dataTransfer?.getData("text/plain")
    const to = navSection.getAttribute("data-nav-path") || ""

    if (from) {
      const fromIsDir = from.startsWith("dir:")
      const fromPath = from.replace(/^(?:dir|file):/, "")
      const destPath = to + "/" + fromPath.split("/").pop()
      if (fromPath === destPath) return
      if (fromIsDir && (to === fromPath || to.startsWith(fromPath + "/"))) {
        if (to.startsWith(fromPath + "/")) {
          showNotification(
            "Cannot move a folder into itself or its own child.",
            { title: "Sorry, not possible", type: "warning" },
          )
        }
        return
      }
      const parts = destPath.split("/")
      let node: unknown = this.tree
      let exists = true
      for (let i = 0; i < parts.length; i++) {
        if (!node || typeof node !== "object") {
          exists = false
          break
        }
        const key = i === parts.length - 1 ? parts[i] + ".md" : parts[i]
        node = (node as Record<string, unknown>)[key]
        if (node === undefined) {
          exists = false
          break
        }
      }
      if (exists) {
        const confirmed = await confirmDialog({
          title: "Replace file?",
          message: `"${destPath}" already exists. Do you want to replace it?`,
          confirmLabel: "Replace",
        })
        if (!confirmed) return
      }
      this.actions?.onMove(fromPath, destPath)
    }
  }
}
