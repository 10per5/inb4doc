import { createRegistry } from "@/components/ui/menu";
import type { MenuItem } from "@/components/ui/menu";
import { MenuType } from "@/components/ui/menu";
import { appEvents, AppEvent } from "@/stores/app-events";
import type { ViewType } from "@/services/view-service";
import { LayoutService } from "@/services/layout-service";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { SlashCommand, LayoutWidth } from "@/config/enums";
import { recentProjectsStore } from "@/stores/recent-projects-store";
import { isMobileDock } from "@/utils/mobile";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps } from "@/entities/PendingOps";
import {
  mediaImage,
  eye,
  menuScale,
  settings,
  hardDrive,
  book,
  shareIos,
  packageIcon,
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
  plus,
  magicWand,
  infoCircle,
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

/**
 * The View and More surfaces, folded into the File dropdown. Only the phone
 * layout wants them — see the comment at the call site.
 */
function fileMobileExtras(): MenuItem[] {
  return [
    {
      type: MenuType.Submenu,
      id: "file-view",
      icon: eye,
      label: "View",
      items: viewMenuItems(),
    },
    {
      type: MenuType.Submenu,
      id: "file-more",
      icon: menuScale,
      label: "More",
      items: moreMenuItems(),
    },
  ];
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
    {
      type: MenuType.Item,
      id: "new-file",
      icon: plus,
      label: "New…",
      onClick: () => appEvents.emit(AppEvent.NewFileRequested),
    },
    ...projectItems,
    {
      type: MenuType.Item,
      id: "format-document",
      icon: magicWand,
      label: "Format document",
      disabled: !formatState.formattable,
      onClick: () => appEvents.emit(AppEvent.FormatDocumentRequested),
    },
    { type: MenuType.Separator },
    ...shareMenuItems(),
    ...compressMenuItems(),
    { type: MenuType.Separator },
    // Mobile-only: the phone topbar has no View menu of its own and no "More"
    // dock tab, so everything those two surfaces reached is folded in here and
    // File is the single entry point. On desktop both already have their own
    // top-level menus — duplicating them only buries Preferences and About.
    ...(isMobileDock() ? fileMobileExtras() : []),
    {
      type: MenuType.Item,
      id: "preferences",
      icon: settings,
      label: "Preferences",
      onClick: () => appEvents.emit(AppEvent.PrefsOpened, {}),
    },
    { type: MenuType.Separator },
    {
      type: MenuType.Item,
      id: "about",
      icon: infoCircle,
      label: "About inb4doc",
      onClick: () => appEvents.emit(AppEvent.AboutOpened),
    },
  ];
});

function viewMenuItems(): MenuItem[] {
  return menuRegistry.get("view") ?? []
}

/**
 * The screens the retired "More" dock screen listed. Pending Changes leads when
 * there is anything pending — it is the row the Files screen's Review button
 * also opens, so the two entry points stay in sync.
 */
function moreMenuItems(): MenuItem[] {
  const pendingCount = new PendingOps(pendingOpsStore.load()).count
  return [
    ...(pendingCount > 0
      ? [
          {
            type: MenuType.Item,
            id: "more-changes",
            icon: clockRotateRight,
            label: "Pending Changes",
            sublabel: String(pendingCount),
            onClick: () => appEvents.emit(AppEvent.DirtyClicked),
          },
        ]
      : []),
    {
      type: MenuType.Item,
      id: "more-disk",
      icon: hardDrive,
      label: "Disk Stats",
      onClick: () => appEvents.emit(AppEvent.ViewChanged, { view: "disk-usage" }),
    },
    {
      type: MenuType.Item,
      id: "more-meta",
      icon: book,
      label: "Meta Panel",
      onClick: () => appEvents.emit(AppEvent.ViewChanged, { view: "meta" }),
    },
    {
      type: MenuType.Item,
      id: "more-images",
      icon: mediaImage,
      label: "Image Manager",
      onClick: () => appEvents.emit(AppEvent.ImageManagerOpened),
    },
  ];
}

// Share / Compress also ship as a standalone dropdown: the mobile topbar has
// no File menu, so its Save button slot hosts one that reaches the same
// actions. Kept as builders so the two surfaces cannot drift apart.
function shareMenuItems(): MenuItem[] {
  return [
    {
      type: MenuType.Submenu,
      id: "share",
      icon: shareIos,
      label: "Share",
      items: [
        {
          type: MenuType.Item,
          id: "share-send",
          label: "Send",
          onClick: () => appEvents.emit(AppEvent.ShareSendRequested),
        },
        {
          type: MenuType.Item,
          id: "share-open",
          label: "Open",
          onClick: () => appEvents.emit(AppEvent.ShareOpenRequested),
        },
      ],
    },
  ];
}

function compressMenuItems(): MenuItem[] {
  return [
    {
      type: MenuType.Submenu,
      id: "compress",
      icon: packageIcon,
      label: "Compress",
      items: [
        {
          type: MenuType.Item,
          id: "save-zip",
          icon: floppyDisk,
          label: "Save (as zip)",
          onClick: () => appEvents.emit(AppEvent.SaveRequested),
        },
        {
          type: MenuType.Item,
          id: "load-zip",
          icon: folder,
          label: "Load",
          onClick: () => appEvents.emit(AppEvent.LoadRequested),
        },
      ],
    },
  ];
}


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

// #6: File → Format document enablement. The menu registry callback can't reach
// the editor, and the topbar chunk is hot, so mirror the shell's
// FormatSuggestionChanged signal in a globalThis flag (same one-time
// subscription pattern as viewState above); the file menu reads it on each open.
interface MenuFormatState {
  formattable: boolean;
}
const formatState = ((
  globalThis as unknown as { __inb4docMenuFormatState?: MenuFormatState }
).__inb4docMenuFormatState ??= { formattable: false });

if (
  !(globalThis as unknown as { __inb4docMenuFormatTracked?: boolean })
    .__inb4docMenuFormatTracked
) {
  (
    globalThis as unknown as { __inb4docMenuFormatTracked?: boolean }
  ).__inb4docMenuFormatTracked = true;
  appEvents.on(AppEvent.FormatSuggestionChanged, ({ formattable }) => {
    formatState.formattable = formattable;
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
    // Panels and screens are both "what the window shows", so the image
    // manager belongs here rather than in File — it opens a browser/manager
    // view over the content, not a document operation.
    {
      type: MenuType.Item,
      id: "img-mgr",
      icon: mediaImage,
      label: "Image Manager",
      onClick: () => appEvents.emit(AppEvent.ImageManagerOpened),
    },
  ];
});
