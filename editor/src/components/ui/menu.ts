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

  constructor(opts: MenuOptions) {
    this.mountEl = opts.mountEl
    this.items = opts.items
    this.boundOutsideClick = this.onOutsideClick.bind(this)
    this.build(opts.label, opts.title)
  }

  get isOpen() { return this._isOpen }

  toggle() { this._isOpen ? this.close() : this.open() }

  open() {
    closeAllMenus(this)
    this.refresh()
    this.panelEl.classList.add("open")
    this._isOpen = true
    openMenus.add(this)
    document.addEventListener("click", this.boundOutsideClick, true)
  }

  close() {
    this.panelEl.classList.remove("open")
    this._isOpen = false
    openMenus.delete(this)
    document.removeEventListener("click", this.boundOutsideClick, true)
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
  }

  destroy() {
    this.close()
    this.mountEl.removeEventListener("click", this.onItemClick)
    this.mountEl.innerHTML = ""
  }

  private build(label: string, title?: string) {
    const id = ++menuCounter
    this.mountEl.innerHTML = `
      <button class="toolbar-menu-trigger" title="${title ?? label}">
        ${label}<span class="arrow">▾</span>
      </button>
      <div class="toolbar-menu" id="menu-panel-${id}"></div>
    `
    this.triggerEl = this.mountEl.querySelector(".toolbar-menu-trigger")!
    this.panelEl = this.mountEl.querySelector(".toolbar-menu")!
    this.triggerEl.addEventListener("click", (e) => {
      e.stopPropagation()
      this.toggle()
    })
    this.mountEl.addEventListener("click", this.onItemClick)
    this.render()
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
