import { Controller } from "@hotwired/stimulus";
import { appEvents, AppEvent } from "@/stores/app-events";
import { ToolbarCommand, TOOLBAR_CMD_PREFIX } from "@/config/enums";
import { ToolbarAction, toolbarActions } from "@/config/enums/toolbar-action";
import * as icons from "@/eta/icons";
import renderTopbar from "@/eta/views/controller/topbar";
import { formatBytes } from "@/utils/format";
import { colors } from "@/config/theme";
import { pressTwiceButton } from "@/components/ui/press-twice-button";
import { Menu } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { hasFunc, AppFunc } from "$/build/build-mode";
import * as focusHandler from "@/services/focus-handler";

export default class extends Controller {
  static targets = ["dirtyCounter", "flushBtn"];

  declare readonly dirtyCounterTarget: HTMLElement;
  declare readonly flushBtnTarget: HTMLButtonElement;

  private unsubs: (() => void)[] = [];
  private menus: Menu[] = [];
  private menusByMnemonic = new Map<string, Menu>();
  private boundKeyDown = (e: KeyboardEvent) => {};
  private boundKeyUp = (e: KeyboardEvent) => {};

  connect() {
    this.element.innerHTML = renderTopbar({
      mobileCss: hasFunc(AppFunc.MobileCss),
      toolbarActions,
      ToolbarAction,
      TOOLBAR_CMD_PREFIX,
      ToolbarCommand,
      icons: icons as Record<string, string>,
    });
    this.createMenus();
    if (hasFunc(AppFunc.ToolbarQuickNav)) {
      this.boundKeyDown = this.onKeyDown.bind(this);
      this.boundKeyUp = this.onKeyUp.bind(this);
      document.addEventListener("keydown", this.boundKeyDown, true);
      document.addEventListener("keyup", this.boundKeyUp, true);
    }
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

    this.element.addEventListener("menu-closed", this.onMenuClosed);
    this.element.addEventListener("menu-arrow", this.onMenuArrow);
    document.addEventListener("click", this.onDocClick);
  }

  disconnect() {
    this.menus.forEach((m) => m.destroy());
    this.menus = [];
    this.menusByMnemonic.clear();
    focusHandler.clear();
    if (this.boundKeyDown) document.removeEventListener("keydown", this.boundKeyDown, true);
    if (this.boundKeyUp) document.removeEventListener("keyup", this.boundKeyUp, true);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    document.removeEventListener("click", this.onDocClick);
    this.element.removeEventListener("menu-closed", this.onMenuClosed);
    this.element.removeEventListener("menu-arrow", this.onMenuArrow);
  }

  private createMenus() {
    const mounts =
      this.element.querySelectorAll<HTMLElement>("[data-menu-name]");
    for (const mount of mounts) {
      const name = mount.dataset.menuName!;
      const mnemonic = hasFunc(AppFunc.ToolbarQuickNav) ? mount.dataset.menuMnemonic?.toLowerCase() : undefined;
      const items = menuRegistry.get(name);
      if (!items) continue;
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      const menu = new Menu({ mountEl: mount, label, title: label, items, mnemonic });
      this.menus.push(menu);
      if (mnemonic) this.menusByMnemonic.set(mnemonic, menu);
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!hasFunc(AppFunc.ToolbarQuickNav)) return;

    if (e.key === "Escape") {
      if (this.isFocusInToolbar()) {
        this.closeAllMenus();
        focusHandler.restore();
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Alt" && !e.repeat) {
      focusHandler.save();
      this.focusMenu("f");
      e.preventDefault();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === "f") {
      focusHandler.save();
      this.openMenuAndFocusFirst("f");
      e.preventDefault();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === "v") {
      focusHandler.save();
      this.openMenuAndFocusFirst("v");
      e.preventDefault();
      return;
    }

    if (this.isFocusInsideMenu()) return;

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (!this.isFocusOnToolbarButton()) return;
      focusHandler.save();
      const all = this.getAllFocusable();
      const idx = all.indexOf(document.activeElement as HTMLElement);
      if (idx < 0) return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (idx + dir + all.length) % all.length;
      const nextEl = all[next];
      if (this.hasOpenMenu()) this.closeAllMenus();
      const mount = nextEl.closest("[data-menu-name]");
      const mnemonic = mount?.getAttribute("data-menu-mnemonic")?.toLowerCase();
      if (mnemonic) {
        this.openMenuAndFocusFirst(mnemonic);
      } else {
        nextEl.focus();
      }
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.isFocusOnTrigger()) return;
      focusHandler.save();
      const trigger = document.activeElement as HTMLElement;
      const mount = trigger.closest("[data-menu-name]");
      const mnemonic = mount?.getAttribute("data-menu-mnemonic")?.toLowerCase();
      if (!mnemonic) return;
      const menu = this.menusByMnemonic.get(mnemonic);
      if (!menu) return;
      if (!menu.isOpen) this.openMenuAndFocusFirst(mnemonic);
      if (e.key === "ArrowDown") menu.focusFirstItem();
      else menu.focusLastItem();
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    // no-op: Alt release does nothing
  };

  private focusMenu(mnemonic: string) {
    const menu = this.menusByMnemonic.get(mnemonic);
    if (menu) menu.focus();
  }

  private openMenuAndFocusFirst(mnemonic: string) {
    const menu = this.menusByMnemonic.get(mnemonic);
    if (menu) menu.openAndFocusFirst();
  }

  private isFocusInToolbar(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return !!active && this.element.contains(active);
  }

  private isFocusOnTrigger(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return !!active && active.classList.contains("toolbar-menu-trigger");
  }

  private isFocusOnToolbarButton(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return !!active && active.tagName === "BUTTON" && this.element.contains(active) && !active.closest(".toolbar-menu");
  }

  private isFocusInsideMenu(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return !!active && !!active.closest(".toolbar-menu");
  }

  private hasOpenMenu(): boolean {
    return this.menus.some((m) => m.isOpen);
  }

  private closeAllMenus() {
    this.menus.forEach((m) => { if (m.isOpen) m.close(); });
  }

  private onMenuClosed = () => {
    focusHandler.restore();
  };

  private onMenuArrow = (e: Event) => {
    const dir = (e as CustomEvent).detail.direction as string;
    const all = this.getAllFocusable();
    const idx = all.indexOf(document.activeElement as HTMLElement);
    if (idx < 0) return;
    const offset = dir === "right" ? 1 : -1;
    const next = (idx + offset + all.length) % all.length;
    const nextEl = all[next];
    if (!nextEl) return;
    const mount = nextEl.closest("[data-menu-name]");
    const mnemonic = mount?.getAttribute("data-menu-mnemonic")?.toLowerCase();
    if (mnemonic) this.openMenuAndFocusFirst(mnemonic);
    else nextEl.focus();
  };

  private getAllFocusable(): HTMLElement[] {
    return Array.from(
      this.element.querySelectorAll<HTMLElement>(".toolbar-section button"),
    ).filter((btn) =>
      !(btn as HTMLButtonElement).disabled &&
      !btn.closest(".toolbar-menu") &&
      !btn.closest(".toolbar-heading-dropdown")
    );
  }

  private getAllTriggers(): HTMLElement[] {
    return Array.from(
      this.element.querySelectorAll<HTMLElement>(".toolbar-relative .toolbar-menu-trigger"),
    );
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

    appEvents.emit(AppEvent.ToolbarCommandExec, { command: cmd });
  }

  execHeading(e: Event) {
    const target = (e.target as HTMLElement).closest(
      "[data-level]",
    ) as HTMLElement | null;
    if (!target) return;
    const level = parseInt(target.dataset.level || "1");

    appEvents.emit(AppEvent.ToolbarCommandExec, { command: ToolbarCommand.Heading, level });

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
