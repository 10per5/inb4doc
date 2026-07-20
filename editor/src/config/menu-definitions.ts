import { createRegistry } from "@/components/ui/menu"
import type { MenuItem } from "@/components/ui/menu"
import { MenuType } from "@/components/ui/menu"
import { appEvents, AppEvent } from "@/stores/app-events"
import type { ViewType } from "@/controllers/view-controller"

export const menuRegistry = createRegistry()

menuRegistry.register("file", () => [
  { type: MenuType.Item, id: "img-mgr", icon: "🖼", label: "Image Manager", onClick: () => appEvents.emit(AppEvent.ImageManagerOpened) },
  { type: MenuType.Separator },
  { type: MenuType.Item, id: "save", icon: "💾", label: "Save as Zip", onClick: () => appEvents.emit(AppEvent.SaveRequested) },
  { type: MenuType.Item, id: "load", icon: "📂", label: "Load from Zip", onClick: () => appEvents.emit(AppEvent.LoadRequested) },
])

let currentView = "editor"
appEvents.on(AppEvent.ViewChanged, ({ view }) => { currentView = view })

menuRegistry.register("view", (): MenuItem[] => [
  {
    type: MenuType.Check, id: "editor", label: "Editor",
    checked: true,
    onUpdate: () => ({ checked: currentView === "editor", active: currentView === "editor" }),
    onClick: () => appEvents.emit(AppEvent.ViewChanged, { view: "editor" as ViewType }),
  },
  {
    type: MenuType.Check, id: "disk-usage", label: "Disk Usage",
    onUpdate: () => ({ checked: currentView === "disk-usage", active: currentView === "disk-usage" }),
    onClick: () => appEvents.emit(AppEvent.ViewChanged, { view: "disk-usage" as ViewType }),
  },
])
