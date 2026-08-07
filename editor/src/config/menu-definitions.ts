import { createRegistry } from "@/components/ui/menu";
import type { MenuItem } from "@/components/ui/menu";
import { MenuType } from "@/components/ui/menu";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { ViewType } from "@/services/view-controller";
import { mediaImage, floppyDisk, folder } from "@/eta/icons";

export const menuRegistry = createRegistry();

menuRegistry.register("file", () => [
  {
    type: MenuType.Item,
    id: "img-mgr",
    icon: mediaImage,
    label: "Image Manager",
    onClick: () => appEvents.emit(AppEvent.ImageManagerOpened),
  },
  { type: MenuType.Separator },
  {
    type: MenuType.Item,
    id: "save",
    icon: floppyDisk,
    label: "Save as Zip",
    onClick: () => appEvents.emit(AppEvent.SaveRequested),
  },
  {
    type: MenuType.Item,
    id: "load",
    icon: folder,
    label: "Load from Zip",
    onClick: () => appEvents.emit(AppEvent.LoadRequested),
  },
]);

// Part D hygiene: the topbar chunk is hot (updatable without a reload), so a
// module-level subscription here would stack a new handler on every hot swap
// re-import. Register once per document (a globalThis flag survives module
// re-execution) and have every module instance read the shared view state.
interface MenuViewState {
  current: string
}
const viewState =
  ((globalThis as unknown as { __inb4docMenuViewState?: MenuViewState })
    .__inb4docMenuViewState ??= { current: "editor" })

if (!(globalThis as unknown as { __inb4docMenuViewTracked?: boolean }).__inb4docMenuViewTracked) {
  ;(globalThis as unknown as { __inb4docMenuViewTracked?: boolean }).__inb4docMenuViewTracked = true
  appEvents.on(AppEvent.ViewChanged, ({ view }) => {
    viewState.current = view
  })
}

menuRegistry.register("view", (): MenuItem[] => [
  {
    type: MenuType.Check,
    id: "editor",
    label: "Editor",
    checked: true,
    onUpdate: () => ({
      checked: viewState.current === "editor",
      active: viewState.current === "editor",
    }),
    onClick: () =>
      appEvents.emit(AppEvent.ViewChanged, { view: "editor" as ViewType }),
  },
  {
    type: MenuType.Check,
    id: "disk-usage",
    label: "Disk Usage",
    onUpdate: () => ({
      checked: viewState.current === "disk-usage",
      active: viewState.current === "disk-usage",
    }),
    onClick: () =>
      appEvents.emit(AppEvent.ViewChanged, { view: "disk-usage" as ViewType }),
  },
]);
