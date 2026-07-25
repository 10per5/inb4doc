import renderMenuItem from "@/eta/menu/item"
import renderSeparator from "@/eta/menu/separator"
import renderCheck from "@/eta/menu/check"
import renderSubmenu from "@/eta/menu/submenu"

export enum MenuType {
  Item,
  Separator,
  Check,
  Submenu,
}

export interface MenuItem {
  type: MenuType
  id?: string
  icon?: string
  label?: string
  checked?: boolean
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  items?: MenuItem[]
  onUpdate?: () => Partial<Pick<MenuItem, "icon" | "label" | "checked" | "active" | "disabled">>
}

export interface MenuRenderData extends Pick<MenuItem, "id" | "icon" | "label" | "active" | "disabled" | "checked"> {
  childrenHtml?: string
}

export interface MenuOptions {
  mountEl: HTMLElement
  label: string
  title?: string
  items: MenuItem[]
  mnemonic?: string
}

export interface MenuRegistry {
  register(name: string, items: MenuItem[] | (() => MenuItem[])): void
  get(name: string): MenuItem[] | undefined
}

const openMenus = new Set<Menu>()
let menuCounter = 0

function closeAllMenus(except?: Menu) {
  for (const m of openMenus) {
    if (m !== except) m.close()
  }
}

function renderItems(items: MenuItem[]): string {
  return items.map((item) => {
    if (item.type === MenuType.Separator) return renderSeparator(item)
    if (item.type === MenuType.Check) return renderCheck(item)
    if (item.type === MenuType.Submenu) {
      return renderSubmenu({ ...item, childrenHtml: renderItems(item.items ?? []) })
    }
    return renderMenuItem(item)
  }).join("")
}

function findItem(items: MenuItem[], id: string): MenuItem | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (item.items) {
      const found = findItem(item.items, id)
      if (found) return found
    }
  }
  return undefined
}

function patchItem(el: HTMLElement, changes: Partial<MenuItem>) {
  if (changes.icon !== undefined) {
    const iconEl = el.querySelector(".menu-item-icon")
    if (iconEl) iconEl.textContent = changes.icon
  }
  if (changes.label !== undefined) {
    const labelEl = el.querySelector(".menu-item-label")
    if (labelEl) labelEl.textContent = changes.label
  }
  if (changes.checked !== undefined) {
    const checkEl = el.querySelector(".check") as HTMLElement | null
    if (checkEl) checkEl.style.display = changes.checked ? "inline" : "none"
  }
  if (changes.active !== undefined) {
    el.classList.toggle("active", changes.active)
  }
  if (changes.disabled !== undefined) {
    el.classList.toggle("disabled", changes.disabled)
  }
}

export function createRegistry(): MenuRegistry {
  const map = new Map<string, MenuItem[] | (() => MenuItem[])>()
  return {
    register(name, items) { map.set(name, items) },
    get(name) {
      const entry = map.get(name)
      return typeof entry === "function" ? entry() : entry
    },
  }
}

export class Menu {
  private mountEl: HTMLElement
  private triggerEl!: HTMLElement
  private panelEl!: HTMLElement
  private items: MenuItem[]
  private _isOpen = false
  private boundOutsideClick: (e: MouseEvent) => void
  private boundPanelKeyDown: (e: KeyboardEvent) => void
  private mnemonic?: string

  constructor(opts: MenuOptions) {
    this.mountEl = opts.mountEl
    this.items = opts.items
    this.mnemonic = opts.mnemonic
    this.boundOutsideClick = this.onOutsideClick.bind(this)
    this.boundPanelKeyDown = this.onPanelKeyDown.bind(this)
    this.build(opts.label, opts.title)
  }

  get isOpen() { return this._isOpen }

  toggle() { this._isOpen ? this.close() : this.open() }

  focus() {
    requestAnimationFrame(() => this.triggerEl.focus())
  }

  open() {
    closeAllMenus(this)
    this.refresh()
    this.panelEl.classList.add("open")
    this.triggerEl.classList.add("is-open")
    this._isOpen = true
    openMenus.add(this)
    requestAnimationFrame(() => this.triggerEl.focus())
    document.addEventListener("click", this.boundOutsideClick, true)
  }

  openAndFocusFirst() {
    this.open()
    requestAnimationFrame(() => this.focusFirstItem())
  }

  close() {
    this.panelEl.classList.remove("open")
    this.triggerEl.classList.remove("is-open")
    this._isOpen = false
    openMenus.delete(this)
    document.removeEventListener("click", this.boundOutsideClick, true)
  }

  focusFirstItem() {
    const items = this.getFocusableItems()
    if (items.length) items[0].focus()
  }

  focusLastItem() {
    const items = this.getFocusableItems()
    if (items.length) items[items.length - 1].focus()
  }

  refresh() {
    for (const item of this.items) {
      if (!item.onUpdate) continue
      const patch = item.onUpdate()
      Object.assign(item, patch)
      if (!item.id) continue
      const el = this.panelEl.querySelector(`#${CSS.escape(item.id)}`) as HTMLElement | null
      if (el) patchItem(el, patch)
    }
  }

  updateItem(id: string, changes: Partial<MenuItem>) {
    const item = findItem(this.items, id)
    if (item) Object.assign(item, changes)
    const el = this.panelEl.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
    if (el) patchItem(el, changes)
  }

  render() {
    this.panelEl.innerHTML = renderItems(this.items)
    this.panelEl.querySelectorAll<HTMLElement>(".menu-item").forEach((el) => {
      el.tabIndex = -1
    })
  }

  destroy() {
    this.close()
    this.mountEl.removeEventListener("click", this.onItemClick)
    this.mountEl.innerHTML = ""
  }

  private build(label: string, title?: string) {
    const id = ++menuCounter
    let displayLabel = label
    if (this.mnemonic) {
      const idx = label.toLowerCase().indexOf(this.mnemonic.toLowerCase())
      if (idx >= 0) {
        displayLabel = label.slice(0, idx) + "<u>" + label[idx] + "</u>" + label.slice(idx + 1)
      }
    }
    this.mountEl.innerHTML = `
      <button class="toolbar-menu-trigger" title="${title ?? label}">
        ${displayLabel}<span class="arrow">▾</span>
      </button>
      <div class="toolbar-menu" id="menu-panel-${id}"></div>
    `
    this.triggerEl = this.mountEl.querySelector(".toolbar-menu-trigger")!
    this.panelEl = this.mountEl.querySelector(".toolbar-menu")!
    this.triggerEl.addEventListener("click", (e) => {
      e.stopPropagation()
      this.toggle()
    })
    this.panelEl.addEventListener("keydown", this.boundPanelKeyDown)
    this.mountEl.addEventListener("click", this.onItemClick)
    this.render()
  }

  private getFocusableItems(container?: HTMLElement): HTMLElement[] {
    const root = container ?? this.panelEl
    return Array.from(root.querySelectorAll<HTMLElement>(".menu-item"))
  }

  private onPanelKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains("menu-item")) return

    const items = this.getFocusableItems()
    const idx = items.indexOf(target)

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault()
        const next = (idx + 1) % items.length
        items[next].focus()
        break
      }
      case "ArrowUp": {
        e.preventDefault()
        const prev = (idx - 1 + items.length) % items.length
        items[prev].focus()
        break
      }
      case "ArrowRight": {
        if (target.classList.contains("menu-item-submenu")) {
          e.preventDefault()
          const sub = target.querySelector<HTMLElement>(".menu-submenu")
          if (sub) {
            sub.style.display = "block"
            const subItems = this.getFocusableItems(sub)
            if (subItems.length) subItems[0].focus()
          }
        } else {
          e.preventDefault()
          this.close()
          this.triggerEl.focus()
          this.mountEl.dispatchEvent(new CustomEvent("menu-arrow", { bubbles: true, detail: { direction: "right" } }))
        }
        break
      }
      case "ArrowLeft": {
        const parentSubmenu = target.closest<HTMLElement>(".menu-submenu")
        if (parentSubmenu) {
          e.preventDefault()
          parentSubmenu.style.display = ""
          const parentItem = parentSubmenu.closest<HTMLElement>(".menu-item")
          if (parentItem) parentItem.focus()
        } else {
          e.preventDefault()
          this.close()
          this.triggerEl.focus()
          this.mountEl.dispatchEvent(new CustomEvent("menu-arrow", { bubbles: true, detail: { direction: "left" } }))
        }
        break
      }
      case "Escape": {
        e.preventDefault()
        e.stopPropagation()
        this.close()
        this.triggerEl.focus()
        this.mountEl.dispatchEvent(new CustomEvent("menu-closed", { bubbles: true }))
        break
      }
      case "Home": {
        e.preventDefault()
        if (items.length) items[0].focus()
        break
      }
      case "End": {
        e.preventDefault()
        if (items.length) items[items.length - 1].focus()
        break
      }
    }
  }

  private onOutsideClick = (e: MouseEvent) => {
    if (!this._isOpen) return
    const target = e.target as HTMLElement
    if (!this.mountEl.contains(target)) this.close()
  }

  private onItemClick = (e: Event) => {
    const target = (e.target as HTMLElement).closest("[data-action='menu-item']") as HTMLElement | null
    if (!target) return
    if (target.classList.contains("disabled")) return
    const item = findItem(this.items, target.id)
    if (!item) return
    item.onClick?.()
    this.close()
  }
}
