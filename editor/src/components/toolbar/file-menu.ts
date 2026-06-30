import { mountDropdownMenu } from "../ui/dropdown-menu"
import type { ViewType } from "../views/view"

export interface FileMenuCallbacks {
  onChangeProvider: () => void
  onViewChange: (view: ViewType) => void
  onSave?: () => void
  onLoad?: () => void
  onImageManager?: () => void
}

export interface FileMenuAPI {
  setProviderBadge(icon: string, label: string): void
  setView(view: ViewType): void
}

export function mountFileMenu(
  mountEl: HTMLElement,
  callbacks: FileMenuCallbacks,
): FileMenuAPI {
  const providerId = "menu-p-" + Math.random().toString(36).slice(2)
  const viewEditorId = "menu-v-editor-" + Math.random().toString(36).slice(2)
  const viewStatsId = "menu-v-stats-" + Math.random().toString(36).slice(2)

  const close = () => {
    document.querySelectorAll(".toolbar-menu.open").forEach((el) => el.classList.remove("open"))
  }

  const menu = mountDropdownMenu({
    mountEl,
    triggerLabel: "File",
    triggerTitle: "File",
    items: [
      {
        type: "item",
        id: providerId,
        icon: "☁️",
        label: "Server",
        onClick: () => { callbacks.onChangeProvider(); close() },
      },
      { type: "separator" },
      {
        type: "submenu",
        label: "View",
        items: [
          {
            type: "item",
            id: viewEditorId,
            label: "Editor",
            check: true,
            active: true,
            onClick: () => { callbacks.onViewChange("editor"); close() },
          },
          {
            type: "item",
            id: viewStatsId,
            label: "Disk Usage",
            check: true,
            onClick: () => { callbacks.onViewChange("disk-usage"); close() },
          },
        ],
      },
      { type: "separator" },
      {
        type: "item",
        icon: "🖼",
        label: "Image Manager",
        onClick: () => { callbacks.onImageManager?.(); close() },
      },
      { type: "separator" },
      {
        type: "item",
        icon: "💾",
        label: "Save as Zip",
        onClick: () => { callbacks.onSave?.(); close() },
      },
      {
        type: "item",
        icon: "📂",
        label: "Load from Zip",
        onClick: () => { callbacks.onLoad?.(); close() },
      },
    ],
  })

  return {
    setProviderBadge(icon: string, label: string) {
      menu.updateItem(providerId, { icon, label })
    },
    setView(view: ViewType) {
      menu.updateItem(viewEditorId, { active: view === "editor" })
      menu.updateItem(viewStatsId, { active: view === "disk-usage" })
    },
  }
}
