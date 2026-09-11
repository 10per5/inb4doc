import { applyPanelFlip, type FlipAnchorRect } from "@/utils/popover"
import renderMenuItem from "@/eta/menu/item"
import renderSeparator from "@/eta/menu/separator"
import { navArrowLeft, navArrowRight, xmark } from "@/eta/icons"
import type { MenuItem } from "./menu"
import { MenuType } from "./menu"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

interface NavLevel {
  items: MenuItem[]
  title: string
  parentId: string | null
}

export interface NavMenuOptions {
  mountEl: HTMLElement
  items: MenuItem[] | (() => MenuItem[])
  panelClass?: string
  title?: string
  anchorRect?: FlipAnchorRect | null
  preferAbove?: boolean
  triggerEl?: HTMLElement
  onOpen?: () => void
  onClose?: () => void
}

const openMenus = new Set<NavMenu>()
function closeAllNavMenus(except?: NavMenu) {
  for (const m of openMenus) if (m !== except) m.close()
}

let autoId = 0

/**
 * Self-navigating drill-down menu. Unlike the generic dropdown (which opens
 * submenus as flyouts that overflow the viewport on narrow screens), a NavMenu
 * keeps a single column: choosing a branch re-renders the panel with that
 * branch's items, resizes to fit, and shows a Back entry. Used for the
 * edit-toolbar "+" add-block menu so it stays pinned to the left edge on
 * phones/tablets instead of spilling off the right.
 */
export class NavMenu {
  private mountEl: HTMLElement
  private panelEl!: HTMLElement
  private listEl!: HTMLElement
  private backEl!: HTMLButtonElement
  private closeEl!: HTMLButtonElement
  private titleEl!: HTMLElement
  private itemResolver: MenuItem[] | (() => MenuItem[])
  private rootItems: MenuItem[]
  private stack: NavLevel[] = []
  private _isOpen = false
  private panelClass?: string
  private anchorRect: FlipAnchorRect | null = null
  private preferAbove = false
  private title: string
  private triggerEl?: HTMLElement
  private onOpen?: () => void
  private onClose?: () => void
  private boundOutsideClick: (e: MouseEvent) => void
  private boundKeyDown: (e: KeyboardEvent) => void

  constructor(opts: NavMenuOptions) {
    this.mountEl = opts.mountEl
    this.itemResolver = opts.items
    this.panelClass = opts.panelClass
    this.anchorRect = opts.anchorRect ?? null
    this.preferAbove = opts.preferAbove ?? false
    this.title = opts.title ?? ""
    this.triggerEl = opts.triggerEl
    this.onOpen = opts.onOpen
    this.onClose = opts.onClose
    this.rootItems = this.resolveItems()
    this.boundOutsideClick = this.onOutsideClick.bind(this)
    this.boundKeyDown = this.onPanelKeyDown.bind(this)
    this.build()
  }

  get isOpen() {
    return this._isOpen
  }

  setAnchorRect(rect: FlipAnchorRect | null, preferAbove = false): void {
    this.anchorRect = rect
    this.preferAbove = preferAbove
  }

  reposition(): void {
    if (this._isOpen) this.positionPanel()
  }

  toggle(): void {
    this._isOpen ? this.close() : this.open()
  }

  open(): void {
    closeAllNavMenus(this)
    this.rootItems = this.resolveItems()
    this.stack = [{ items: this.rootItems, title: this.title, parentId: null }]
    this.renderLevel()
    this.panelEl.classList.add("open")
    this.triggerEl?.classList.add("is-open")
    this._isOpen = true
    openMenus.add(this)
    document.addEventListener("click", this.boundOutsideClick, true)
    requestAnimationFrame(() => this.focusFirstItem())
    this.onOpen?.()
  }

  openAndFocusFirst(): void {
    this.open()
  }

  close(): void {
    this.panelEl.classList.remove("open")
    this.triggerEl?.classList.remove("is-open")
    this._isOpen = false
    openMenus.delete(this)
    document.removeEventListener("click", this.boundOutsideClick, true)
    this.onClose?.()
  }

  destroy(): void {
    this.close()
    this.mountEl.innerHTML = ""
  }

  private resolveItems(): MenuItem[] {
    return typeof this.itemResolver === "function" ? this.itemResolver() : this.itemResolver
  }

  private build(): void {
    const panelClass = this.panelClass ? ` ${this.panelClass}` : ""
    this.mountEl.innerHTML = `
      <div class="nav-menu${panelClass}" role="menu">
        <div class="nav-menu-header">
          <button type="button" class="nav-menu-back" aria-label="Back">${navArrowLeft}</button>
          <button type="button" class="nav-menu-close" aria-label="Close">${xmark}</button>
          <span class="nav-menu-title"></span>
        </div>
        <div class="nav-menu-list" role="menu"></div>
      </div>`
    this.panelEl = this.mountEl.querySelector(".nav-menu")!
    this.backEl = this.panelEl.querySelector(".nav-menu-back") as HTMLButtonElement
    this.closeEl = this.panelEl.querySelector(".nav-menu-close") as HTMLButtonElement
    this.titleEl = this.panelEl.querySelector(".nav-menu-title")!
    this.listEl = this.panelEl.querySelector(".nav-menu-list")!
    this.backEl.addEventListener("click", () => this.back())
    this.closeEl.addEventListener("click", () => this.close())
    this.panelEl.addEventListener("keydown", this.boundKeyDown)
    this.listEl.addEventListener("click", this.onItemClick)
  }

  private get currentLevel(): NavLevel {
    return this.stack[this.stack.length - 1]
  }

  private renderLevel(): void {
    const level = this.currentLevel
    this.titleEl.textContent = level.title
    const atRoot = this.stack.length <= 1
    this.backEl.classList.toggle("is-hidden", atRoot)
    this.closeEl.classList.toggle("is-hidden", !atRoot)
    this.listEl.innerHTML = level.items.map((item) => this.renderItem(item)).join("")
    this.listEl.querySelectorAll<HTMLElement>(".menu-item").forEach((el) => (el.tabIndex = -1))
    // Re-trigger the enter animation on every navigation.
    this.listEl.classList.remove("nav-menu-list--enter")
    void this.listEl.offsetWidth
    this.listEl.classList.add("nav-menu-list--enter")
    this.positionPanel()
  }

  private renderItem(item: MenuItem): string {
    if (!item.id && item.type !== MenuType.Separator) item.id = `nav-item-${++autoId}`
    if (item.type === MenuType.Separator) return renderSeparator(item)
    if (item.type === MenuType.Submenu) {
      const disabled = item.disabled ? " disabled" : ""
      return `<div class="menu-item nav-menu-branch${disabled}"${item.id ? ` id="${item.id}"` : ""} data-action="menu-item" data-nav="1" role="menuitem" aria-haspopup="true">
        ${item.icon ? `<span class="menu-item-icon">${item.icon}</span>` : ""}
        <span class="menu-item-label">${escapeHtml(item.label ?? "")}</span>
        <span class="menu-item-chevron">${navArrowRight}</span>
      </div>`
    }
    // Leaf (Item / Check) — delegate to the shared renderer.
    return renderMenuItem(item)
  }

  private itemAt(el: HTMLElement): MenuItem | undefined {
    if (!el.id) return undefined
    return this.currentLevel.items.find((it) => it.id === el.id)
  }

  private drill(item: MenuItem): void {
    this.stack.push({
      items: item.items ?? [],
      title: item.label ?? this.title,
      parentId: item.id ?? null,
    })
    this.renderLevel()
    requestAnimationFrame(() => this.focusFirstItem())
  }

  private back(): void {
    if (this.stack.length <= 1) {
      this.close()
      return
    }
    const parentId = this.currentLevel.parentId
    this.stack.pop()
    this.renderLevel()
    requestAnimationFrame(() => {
      const el = parentId
        ? this.listEl.querySelector<HTMLElement>(`#${CSS.escape(parentId)}`)
        : null
      if (el) el.focus()
      else this.focusFirstItem()
    })
  }

  private getFocusableItems(): HTMLElement[] {
    return Array.from(this.listEl.querySelectorAll<HTMLElement>(".menu-item"))
  }

  private focusFirstItem(): void {
    const items = this.getFocusableItems()
    if (items.length) items[0].focus()
  }

  private onItemClick = (e: Event): void => {
    const target = (e.target as HTMLElement).closest("[data-action='menu-item']") as HTMLElement | null
    if (!target) return
    if (target.classList.contains("disabled")) return
    const item = this.itemAt(target)
    if (!item) return
    if (target.dataset.nav === "1") {
      this.drill(item)
    } else {
      item.onClick?.()
      this.close()
    }
  }

  private onPanelKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement
    if (!target.classList.contains("menu-item")) return
    const items = this.getFocusableItems()
    const idx = items.indexOf(target)
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (items.length) items[(idx + 1) % items.length].focus()
        break
      case "ArrowUp":
        e.preventDefault()
        if (items.length) items[(idx - 1 + items.length) % items.length].focus()
        break
      case "ArrowRight":
        if (target.dataset.nav === "1") {
          e.preventDefault()
          const item = this.itemAt(target)
          if (item) this.drill(item)
        }
        break
      case "ArrowLeft":
        e.preventDefault()
        if (this.stack.length > 1) this.back()
        else this.close()
        break
      case "Enter":
      case " ":
        e.preventDefault()
        if (target.dataset.nav === "1") {
          const item = this.itemAt(target)
          if (item) this.drill(item)
        } else {
          const item = this.itemAt(target)
          item?.onClick?.()
          this.close()
        }
        break
      case "Escape":
        e.preventDefault()
        e.stopPropagation()
        if (this.stack.length > 1) this.back()
        else this.close()
        break
      case "Home":
        e.preventDefault()
        if (items.length) items[0].focus()
        break
      case "End":
        e.preventDefault()
        if (items.length) items[items.length - 1].focus()
        break
    }
  }

  private onOutsideClick = (e: MouseEvent): void => {
    if (!this._isOpen) return
    const target = e.target as HTMLElement
    if (this.triggerEl && (target === this.triggerEl || this.triggerEl.contains(target))) return
    if (!this.mountEl.contains(target)) this.close()
  }

  private positionPanel(): void {
    const anchor = this.anchorRect ?? this.mountEl.getBoundingClientRect()
    applyPanelFlip(this.panelEl, {
      anchor,
      preferAbove: this.preferAbove,
      flipX: this.anchorRect !== null || !this.panelClass,
      positionAnchor: this.anchorRect !== null,
    })
  }
}
