import { createRegistry } from "@/components/ui/menu";
import type { MenuItem } from "@/components/ui/menu";
import { MenuType } from "@/components/ui/menu";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { ViewType } from "@/services/view-service";
import { LayoutService } from "@/services/layout-service";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { SlashCommand, LayoutWidth } from "@/config/enums";
import { recentProjectsStore } from "@/stores/recent-projects-store";
import {
  mediaImage,
  floppyDisk,
  folder,
  folderOpen,
  clockRotateRight,
  list,
  checkSquare,
  minus,
  navArrowRight,
  navArrowLeft,
  text,
  numberedListLeft,
  quote,
  codeBrackets,
  mathBook,
  table,
  videoCamera,
} from "@/eta/icons";

export const menuRegistry = createRegistry();

function emitInsertBlockCommand(command: SlashCommand, level?: number): void {
  appEvents.emit(AppEvent.InsertBlockCommand, { command, level });
}

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
  current: string;
}
const viewState = ((
  globalThis as unknown as { __inb4docMenuViewState?: MenuViewState }
).__inb4docMenuViewState ??= { current: "editor" });

if (
  !(globalThis as unknown as { __inb4docMenuViewTracked?: boolean })
    .__inb4docMenuViewTracked
) {
  (
    globalThis as unknown as { __inb4docMenuViewTracked?: boolean }
  ).__inb4docMenuViewTracked = true;
  appEvents.on(AppEvent.ViewChanged, ({ view }) => {
    viewState.current = view;
  });
}

// Shared "insert block" menu: the mobile FAB "+" popup and the desktop
// block-handle "+" open the same grouped menu. Commands emit InsertBlockCommand
// (decoupled — the executor lives in the editor feature, loaded on demand).
menuRegistry.register("add-block", (): MenuItem[] => [
  {
    type: MenuType.Submenu,
    id: "headings",
    icon: text,
    label: "Headings",
    items: [
      {
        type: MenuType.Item,
        id: "h1",
        icon: text,
        label: "Heading 1",
        onClick: () => emitInsertBlockCommand(SlashCommand.Heading, 1),
      },
      {
        type: MenuType.Item,
        id: "h2",
        icon: text,
        label: "Heading 2",
        onClick: () => emitInsertBlockCommand(SlashCommand.Heading, 2),
      },
      {
        type: MenuType.Item,
        id: "h3",
        icon: text,
        label: "Heading 3",
        onClick: () => emitInsertBlockCommand(SlashCommand.Heading, 3),
      },
    ],
  },
  {
    type: MenuType.Submenu,
    id: "list",
    icon: list,
    label: "List",
    items: [
      {
        type: MenuType.Item,
        id: "bullet",
        icon: list,
        label: "Bullet list",
        onClick: () => emitInsertBlockCommand(SlashCommand.BulletList),
      },
      {
        type: MenuType.Item,
        id: "ordered",
        icon: numberedListLeft,
        label: "Ordered list",
        onClick: () => emitInsertBlockCommand(SlashCommand.OrderedList),
      },
      {
        type: MenuType.Item,
        id: "checkbox",
        icon: checkSquare,
        label: "Checkbox",
        onClick: () => emitInsertBlockCommand(SlashCommand.TodoList),
      },
    ],
  },
  {
    type: MenuType.Submenu,
    id: "code",
    icon: codeBrackets,
    label: "Code",
    items: [
      {
        type: MenuType.Item,
        id: "code-block",
        icon: codeBrackets,
        label: "Code block",
        onClick: () => emitInsertBlockCommand(SlashCommand.CodeBlock),
      },
      {
        type: MenuType.Item,
        id: "math-block",
        icon: mathBook,
        label: "Math block",
        onClick: () => emitInsertBlockCommand(SlashCommand.MathBlock),
      },
    ],
  },
  {
    type: MenuType.Submenu,
    id: "widgets",
    icon: table,
    label: "Widgets",
    items: [
      {
        type: MenuType.Item,
        id: "table",
        icon: table,
        label: "Table",
        onClick: () => emitInsertBlockCommand(SlashCommand.Table),
      },
      {
        type: MenuType.Item,
        id: "image",
        icon: mediaImage,
        label: "Image",
        onClick: () => emitInsertBlockCommand(SlashCommand.Image),
      },
      {
        type: MenuType.Item,
        id: "video",
        icon: videoCamera,
        label: "Video",
        onClick: () => emitInsertBlockCommand(SlashCommand.Video),
      },
    ],
  },
  {
    type: MenuType.Item,
    id: "blockquote",
    icon: quote,
    label: "Blockquote",
    onClick: () => emitInsertBlockCommand(SlashCommand.Blockquote),
  },
  {
    type: MenuType.Item,
    id: "divider",
    icon: minus,
    label: "Divider",
    onClick: () => emitInsertBlockCommand(SlashCommand.ThematicBreak),
  },
]);

menuRegistry.register("view", (): MenuItem[] => {
  const layout = LayoutService.getInstance();
  const screen = (view: ViewType, label: string): MenuItem => ({
    type: MenuType.Check,
    id: view,
    label,
    checked: viewState.current === view,
    active: viewState.current === view,
    onClick: () => appEvents.emit(AppEvent.ViewChanged, { view }),
  });
  return [
    {
      type: MenuType.Submenu,
      id: "view-screens",
      label: "Screens",
      items: [
        screen("editor", "Editor"),
        screen("disk-usage", "Disk Usage"),
        // Navigation is the nav tree as a center fullview; on tablet the tree
        // is already the left sidebar, so the redundant screen entry is hidden.
        // The sidebar-collapse path (ViewService.switchTo → setLeftPanel)
        // stays central for future reuse.
        ...(layout.getWidth() === LayoutWidth.Tablet
          ? []
          : [screen("navigation", "Navigation")]),
      ],
    },
    {
      type: MenuType.Submenu,
      id: "view-panels",
      label: "Panels",
      items: [
        {
          type: MenuType.Check,
          id: "navtree",
          label: "Navtree",
          checked: layout.isLeftPanelOn(),
          active: layout.isLeftPanelOn(),
          onClick: () => layout.toggleLeftPanel(),
        },
        {
          type: MenuType.Check,
          id: "meta-panel",
          label: "Meta panel",
          checked: layout.isRightPanelOn(),
          active: layout.isRightPanelOn(),
          onClick: () => layout.toggleRightPanel(),
        },
      ],
    },
  ];
});
