import { Controller } from "@hotwired/stimulus"
import type { SidebarActions } from "@/components/panels/sidebar"
import { sidebarActions, SidebarAction } from "@/config/enums"

const pendingActions = new Map<HTMLElement, SidebarActions>()

export function setContextMenuActions(el: HTMLElement, actions: SidebarActions) {
  pendingActions.set(el, actions)
}

export default class extends Controller {
  private pagePath = ""
  private isFolder = false
  private actions: SidebarActions | null = null

  private get el(): HTMLElement {
    return this.element as HTMLElement
  }

  connect() {
    this.pagePath = this.el.dataset.pagePath || ""
    this.isFolder = "isFolder" in this.el.dataset
    this.actions = pendingActions.get(this.el) || null
    pendingActions.delete(this.el)

    const top = this.el.dataset.menuTop || ""
    const left = this.el.dataset.menuLeft || ""

    this.el.innerHTML = `
      <div class="ctx-backdrop" data-action="click->context-menu#close"></div>
      <div class="ctx-menu" style="top:${top};left:${left}">
        <div class="ctx-action" data-action="click->context-menu#${sidebarActions[SidebarAction.New]}">New…</div>
        <div class="ctx-action" data-action="click->context-menu#${sidebarActions[SidebarAction.Rename]}">Rename</div>
        <div class="ctx-action action-delete" data-action="click->context-menu#${sidebarActions[SidebarAction.Delete]}">Delete</div>
      </div>
    `
  }

  close() {
    this.el.remove()
  }

  onNew() {
    this.el.remove()
    this.actions?.onNewItem(this.pagePath, this.isFolder)
  }

  onRename() {
    this.el.remove()
    this.actions?.onRename(this.pagePath)
  }

  onDelete() {
    this.el.remove()
    this.actions?.onDelete(this.pagePath)
  }
}
