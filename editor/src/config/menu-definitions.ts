import { createRegistry } from "@/components/ui/menu";
import type { MenuItem } from "@/components/ui/menu";
import { MenuType } from "@/components/ui/menu";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { ViewType } from "@/services/view-controller";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { recentProjectsStore } from "@/stores/recent-projects-store";
import { mediaImage, floppyDisk, folder, folderOpen, clockRotateRight } from "@/eta/icons";

export const menuRegistry = createRegistry();

function recentProjectItems(): MenuItem[] {
  const recents = recentProjectsStore.list();
  if (recents.length === 0) {
    return [
      {
        type: MenuType.Item,
        id: "recent-none",
        label: "No recent projects",
        disabled: true,
      },
    ];
  }
  return recents.map((recent, i) => ({
    type: MenuType.Item,
    id: `recent-${i}`,
    icon: folder,
    label: recent.name,
    sublabel: recent.path,
    onClick: () =>
      appEvents.emit(AppEvent.RecentProjectRequested, { path: recent.path }),
  }));
}

menuRegistry.register("file", (): MenuItem[] => {
  const projectItems: MenuItem[] = hasFunc(AppFunc.ProjectPicker)
    ? [
        {
          type: MenuType.Item,
          id: "open-project",
          icon: folderOpen,
          label: "Open Project…",
          onClick: () => appEvents.emit(AppEvent.OpenProjectRequested),
        },
        {
          type: MenuType.Submenu,
          id: "recent-projects",
          icon: clockRotateRight,
          label: "Recent Projects",
          items: recentProjectItems(),
        },
        { type: MenuType.Separator },
      ]
    : [];
  return [
    ...projectItems,
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
  ];
});

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
