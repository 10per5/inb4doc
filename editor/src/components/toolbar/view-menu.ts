import { mountDropdownMenu } from "@/components/ui/dropdown-menu"
import type { ViewType } from "@/controllers/view-controller"
import { appEvents, AppEvent } from "@/stores/app-events"

export interface ViewMenuAPI {
  setView(view: ViewType): void
}

export function mountViewMenu(mountEl: HTMLElement): ViewMenuAPI {
  const viewEditorId = "menu-v-editor-" + Math.random().toString(36).slice(2)
  const viewStatsId = "menu-v-stats-" + Math.random().toString(36).slice(2)

  const close = () => {
    document.querySelectorAll(".toolbar-menu.open").forEach((el) => el.classList.remove("open"))
    document.querySelectorAll(".toolbar-heading-dropdown.open").forEach((el) => el.classList.remove("open"))
  }

  const menu = mountDropdownMenu({
    mountEl,
    triggerLabel: "View",
    triggerTitle: "View",
    items: [
      {
        type: "item",
        id: viewEditorId,
        label: "Editor",
        check: true,
        onClick: () => { appEvents.emit(AppEvent.ViewChanged, { view: "editor" }); close() },
      },
      {
        type: "item",
        id: viewStatsId,
        label: "Disk Usage",
        check: false,
        onClick: () => { appEvents.emit(AppEvent.ViewChanged, { view: "disk-usage" }); close() },
      },
    ],
  })

  return {
    setView(view: ViewType) {
      menu.updateItem(viewEditorId, { check: view === "editor" })
      menu.updateItem(viewStatsId, { check: view === "disk-usage" })
    },
  }
}
