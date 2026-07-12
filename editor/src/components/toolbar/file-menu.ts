import { mountDropdownMenu } from "@/components/ui/dropdown-menu"
import { appEvents, AppEvent } from "@/stores/app-events"

export function mountFileMenu(mountEl: HTMLElement) {
  const close = () => {
    document.querySelectorAll(".toolbar-menu.open").forEach((el) => el.classList.remove("open"))
    document.querySelectorAll(".toolbar-heading-dropdown.open").forEach((el) => el.classList.remove("open"))
  }

  mountDropdownMenu({
    mountEl,
    triggerLabel: "File",
    triggerTitle: "File",
    items: [
      {
        type: "item",
        id: "menu-img-" + Math.random().toString(36).slice(2),
        icon: "🖼",
        label: "Image Manager",
        onClick: () => { appEvents.emit(AppEvent.ImageManagerOpened); close() },
      },
      { type: "separator" },
      {
        type: "item",
        id: "menu-save-" + Math.random().toString(36).slice(2),
        icon: "💾",
        label: "Save as Zip",
        onClick: () => { appEvents.emit(AppEvent.SaveRequested); close() },
      },
      {
        type: "item",
        id: "menu-load-" + Math.random().toString(36).slice(2),
        icon: "📂",
        label: "Load from Zip",
        onClick: () => { appEvents.emit(AppEvent.LoadRequested); close() },
      },
    ],
  })
}
