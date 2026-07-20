import { Controller } from "@hotwired/stimulus";
import type { Editor } from "@milkdown/kit/core";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { openLinkDialog } from "@/components/dialogs/link-dialog";
import { formatBytes } from "@/utils/format";
import { colors } from "@/config/theme";
import { appEvents, AppEvent } from "@/stores/app-events";
import { pressTwiceButton } from "@/components/ui/press-twice-button";
import { Menu } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { ToolbarCommand, TOOLBAR_CMD_PREFIX } from "@/config/enums";

export default class extends Controller {
  static targets = ["dirtyCounter", "flushBtn"];

  declare readonly dirtyCounterTarget: HTMLElement;
  declare readonly flushBtnTarget: HTMLButtonElement;

  private getEditor: (() => Editor | null) | null = null;
  private unsubs: (() => void)[] = [];
  private menus: Menu[] = [];

  setEditorGetter(getter: () => Editor | null) {
    this.getEditor = getter;
  }

  connect() {
    this.createMenus();
    this.unsubs.push(
      appEvents.on(
        AppEvent.DirtyChanged,
        ({ count, bytes, pendingCount, singleDirtyPath, currentPath }) => {
          this.updateDirtyCounter(
            count,
            bytes,
            pendingCount,
            singleDirtyPath,
            currentPath,
          );
        },
      ),
    );

    document.addEventListener("click", this.onDocClick);
  }

  disconnect() {
    this.menus.forEach((m) => m.destroy());
    this.menus = [];
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    document.removeEventListener("click", this.onDocClick);
  }

  private createMenus() {
    const mounts =
      this.element.querySelectorAll<HTMLElement>("[data-menu-name]");
    for (const mount of mounts) {
      const name = mount.dataset.menuName!;
      const items = menuRegistry.get(name);
      if (!items) continue;
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      const menu = new Menu({ mountEl: mount, label, title: label, items });
      this.menus.push(menu);
    }
  }

  // ── Actions ──

  execCommand(e: Event) {
    const target = (e.target as HTMLElement).closest(
      "[data-cmd]",
    ) as HTMLElement | null;
    if (!target) return;
    const cmdStr = target.dataset.cmd;
    if (!cmdStr) return;

    const cmd = Number(
      cmdStr.replace(TOOLBAR_CMD_PREFIX, ""),
    ) as ToolbarCommand;
    if (isNaN(cmd)) return;

    const milkdown = this.getEditor?.();
    if (!milkdown) return;

    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      const commands = ctx.get(commandsCtx);
      switch (cmd) {
        case ToolbarCommand.Bold:
          commands.call(toggleStrongCommand.key);
          break;
        case ToolbarCommand.Italic:
          commands.call(toggleEmphasisCommand.key);
          break;
        case ToolbarCommand.Strike:
          commands.call(toggleStrikethroughCommand.key);
          break;
        case ToolbarCommand.Code:
          commands.call(toggleInlineCodeCommand.key);
          break;
        case ToolbarCommand.Link:
          openLinkDialog(this.getEditor!);
          break;
        case ToolbarCommand.Heading:
          commands.call(wrapInHeadingCommand.key);
          break;
        case ToolbarCommand.Hr:
          commands.call(insertHrCommand.key);
          break;
      }
    });
  }

  execHeading(e: Event) {
    const target = (e.target as HTMLElement).closest(
      "[data-level]",
    ) as HTMLElement | null;
    if (!target) return;
    const level = parseInt(target.dataset.level || "1");

    const milkdown = this.getEditor?.();
    if (!milkdown) return;

    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      const commands = ctx.get(commandsCtx);
      commands.call(wrapInHeadingCommand.key, level);
    });

    this.closeHeadingDropdown();
  }

  toggleHeadingDropdown() {
    const el = this.element.querySelector(
      ".toolbar-heading-dropdown",
    ) as HTMLElement;
    const opening = !el?.classList.contains("open");
    if (opening) {
      document
        .querySelectorAll(".toolbar-menu.open")
        .forEach((m) => m.classList.remove("open"));
    }
    el?.classList.toggle("open");
  }

  toggleSidebar() {
    appEvents.emit(AppEvent.SidebarToggle);
  }

  toggleMetaPanel() {
    appEvents.emit(AppEvent.MetaPanelToggle);
  }

  flushAll() {
    appEvents.emit(AppEvent.FlushAll);
  }

  openPrefs() {
    appEvents.emit(AppEvent.PrefsOpened);
  }

  dirtyClicked() {
    appEvents.emit(AppEvent.DirtyClicked);
  }

  sourceMode() {
    appEvents.emit(AppEvent.SourceModeToggled);
  }

  // ── Private ──

  private onDocClick = (e: MouseEvent) => {
    const dropdown = this.element.querySelector(
      ".toolbar-heading-dropdown",
    ) as HTMLElement | null;
    if (!dropdown?.classList.contains("open")) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".toolbar-heading-wrap")) {
      dropdown.classList.remove("open");
    }
  };

  private closeHeadingDropdown() {
    const el = this.element.querySelector(
      ".toolbar-heading-dropdown",
    ) as HTMLElement | null;
    el?.classList.remove("open");
  }

  private updateDirtyCounter(
    count: number,
    bytes: number,
    pendingCount: number,
    singleDirtyPath?: string,
    currentPath?: string,
  ) {
    const el = this.dirtyCounterTarget;
    if (!el) return;

    el.style.display = "";
    el.textContent = "";
    el.classList.toggle("clickable", false);

    const hasDirty = count > 0 || pendingCount > 0;

    if (
      count === 1 &&
      pendingCount === 0 &&
      singleDirtyPath &&
      singleDirtyPath === currentPath
    ) {
      el.prepend(createChangesBtn());
      const btn = pressTwiceButton({
        idleText: "⟲",
        pendingText: "Press again",
        variant: "danger",
        small: true,
        idleBadge: `(${formatBytes(bytes)})`,
        onConfirm: () =>
          appEvents.emit(AppEvent.SingleDiscardRequested, {
            path: singleDirtyPath,
          }),
      });
      el.appendChild(btn);
    } else if (hasDirty) {
      const parts: string[] = [];
      if (count > 0) {
        const color =
          bytes > 0 ? colors.green : bytes < 0 ? colors.danger : "inherit";
        parts.push(
          `<span>${count} unsaved</span><span style="color:${color};font-size:0.7rem;margin-left:4px">${formatBytes(bytes)}</span>`,
        );
      }
      if (pendingCount > 0) {
        parts.push(
          `<span style="color:#856404;font-size:0.7rem">${pendingCount} pending</span>`,
        );
      }
      el.innerHTML = `<div style="display:flex;gap:6px;align-items:center">${parts.join('<span style="color:#ccc">|</span>')}</div>`;
      el.classList.toggle("clickable", true);
    }

    this.flushBtnTarget.disabled = !hasDirty;
  }
}

function createChangesBtn(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "changes-btn";
  btn.title = "View all changes";
  btn.textContent = "👁";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    appEvents.emit(AppEvent.DirtyClicked);
  });
  return btn;
}
