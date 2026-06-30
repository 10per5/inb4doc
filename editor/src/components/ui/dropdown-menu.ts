import { html, render } from "lit-html"

export interface MenuItem {
  type: "item" | "separator" | "submenu"
  id?: string
  icon?: string
  label?: string
  onClick?: () => void
  items?: MenuItem[]
  check?: boolean
  active?: boolean
}

export interface DropdownMenuOptions {
  triggerLabel: string
  triggerTitle?: string
  items: MenuItem[]
  mountEl: HTMLElement
  onItemClick?: (item: MenuItem) => void
}

let menuCounter = 0

function renderMenuItems(items: MenuItem[], depth: number = 0): any {
  return items.map((item) => {
    if (item.type === "separator") {
      return html`<div class="menu-sep"></div>`
    }
    if (item.type === "submenu") {
      return html`
        <div class="menu-item menu-item-submenu" id="${item.id ?? ""}">
          <span class="menu-item-label">${item.label ?? ""}</span>
          <span class="menu-submenu-arrow">▸</span>
          <div class="menu-submenu">
            ${renderMenuItems(item.items ?? [], depth + 1)}
          </div>
        </div>
      `
    }
    return html`
      <div class="menu-item${item.active ? " active" : ""}" id="${item.id ?? ""}" data-action="menu-item">
        ${item.icon ? html`<span class="menu-item-icon">${item.icon}</span>` : ""}
        <span class="menu-item-label">${item.label ?? ""}</span>
        ${item.check !== undefined ? html`<span class="check" style="display:${item.check ? "inline" : "none"}">✓</span>` : ""}
      </div>
    `
  })
}

export function mountDropdownMenu(opts: DropdownMenuOptions): { updateItem: (id: string, changes: Partial<MenuItem>) => void } {
  const { mountEl, triggerLabel, triggerTitle, items } = opts
  const id = `dropdown-menu-${++menuCounter}`
  const triggerId = `${id}-trigger`
  const menuId = `${id}-menu`

  const tmpl = html`
    <button class="toolbar-menu-trigger" id="${triggerId}" title="${triggerTitle ?? triggerLabel}">
      ${triggerLabel}<span class="arrow">▾</span>
    </button>
    <div class="toolbar-menu" id="${menuId}">
      ${renderMenuItems(items)}
    </div>
  `

  render(tmpl, mountEl)

  const trigger = mountEl.querySelector(`#${triggerId}`) as HTMLElement
  const menu = mountEl.querySelector(`#${menuId}`) as HTMLElement

  trigger?.addEventListener("click", (e) => {
    menu?.classList.toggle("open")
    e.stopPropagation()
  })

  document.addEventListener("click", (e) => {
    if (!menu?.classList.contains("open")) return
    const target = e.target as HTMLElement
    if (!target.closest(`#${menuId}`) && !target.closest(`#${triggerId}`)) {
      menu.classList.remove("open")
    }
  })

  menu?.addEventListener("click", (e) => {
    const itemEl = (e.target as HTMLElement).closest("[data-action='menu-item']") as HTMLElement | null
    if (!itemEl) return
    const idx = items.findIndex((it) => it.id === itemEl.id)
    if (idx === -1) return
    const item = items[idx]
    item.onClick?.()
    opts.onItemClick?.(item)
    menu.classList.remove("open")
  })

  return {
    updateItem(id: string, changes: Partial<MenuItem>) {
      const item = items.find((it) => it.id === id)
      if (!item) return
      Object.assign(item, changes)
      const itemEl = document.getElementById(id)
      if (!itemEl) return
      if (changes.icon !== undefined) {
        const iconEl = itemEl.querySelector(".menu-item-icon")
        if (iconEl) iconEl.textContent = changes.icon
      }
      if (changes.label !== undefined) {
        const labelEl = itemEl.querySelector(".menu-item-label")
        if (labelEl) labelEl.textContent = changes.label
      }
      if (changes.check !== undefined) {
        const checkEl = itemEl.querySelector(".check") as HTMLElement | null
        if (checkEl) checkEl.style.display = changes.check ? "inline" : "none"
      }
      if (changes.active !== undefined) {
        itemEl.classList.toggle("active", changes.active)
      }
    },
  }
}
