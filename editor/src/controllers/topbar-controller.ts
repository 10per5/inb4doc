import { Controller } from "@hotwired/stimulus";
import { appEvents, AppEvent } from "@/stores/app-events";
import { ToolbarCommand, TOOLBAR_CMD_PREFIX } from "@/config/enums";
import { LIST_KIND_COMMANDS, type ListKind } from "@/config/list-kinds";
import { ToolbarAction, toolbarActions } from "@/config/enums/toolbar-action";
import { EMPTY_TEXT_STATE, type TextState } from "@/config/enums/text-state";
import {
  ActiveBlockType,
  EMPTY_BLOCK_CONTEXT,
  type ActiveBlockContext,
} from "@/config/enums/block-context";
import * as icons from "@/eta/icons";
import renderTopbar from "@/eta/views/controller/topbar";
import { formatBytes } from "@/utils/format";
import { colors } from "@/config/theme";
import { pressTwiceButton } from "@/components/ui/press-twice-button";
import { Menu } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { hasFunc, AppFunc } from "$/build/build-mode";
import { isMobileDock } from "@/utils/mobile";
import * as focusHandler from "@/services/focus-handler-service";

export default class extends Controller {
  static targets = [
    "dirtyCounter",
    "flushBtn",
    "overflowWrap",
    "overflowBtn",
    "overflowDropdown",
  ];

  declare readonly dirtyCounterTarget: HTMLElement;
  declare readonly flushBtnTarget: HTMLButtonElement;
  declare readonly overflowWrapTarget: HTMLElement;
  declare readonly overflowBtnTarget: HTMLButtonElement;
  declare readonly overflowDropdownTarget: HTMLElement;
  declare readonly hasOverflowWrapTarget: boolean;
  declare readonly hasOverflowBtnTarget: boolean;
  declare readonly hasOverflowDropdownTarget: boolean;

  private unsubs: (() => void)[] = [];
  private menus: Menu[] = [];
  private menusByMnemonic = new Map<string, Menu>();
  private boundKeyDown = (e: KeyboardEvent) => {};
  private boundKeyUp = (e: KeyboardEvent) => {};
  private resizeObserver: ResizeObserver | null = null;
  private lastOverflowKey = "";

  connect() {
    this.element.innerHTML = renderTopbar({
      mobileCss: hasFunc(AppFunc.MobileCss),
      mobileDock: isMobileDock(),
      toolbarActions,
      ToolbarAction,
      TOOLBAR_CMD_PREFIX,
      ToolbarCommand,
      icons: icons as Record<string, string>,
    });
    this.createMenus();
    // The desktop topbar participates in the procedural overflow layout; the
    // mobile variant manages its own width. The class also pins section
    // flex-shrink so measurement reads natural widths instead of squished ones.
    this.element.classList.toggle("toolbar-desktop", !isMobileDock());
    if (this.hasOverflowWrapTarget) {
      this.resizeObserver = new ResizeObserver(() => this.relayout());
      this.resizeObserver.observe(this.element);
      this.relayout();
    }
    // Mobile: the topbar is editor-chrome — hide it on every other view
    // (navigation/more/meta/disk-usage/empty states render their own headers).
    if (isMobileDock()) {
      this.unsubs.push(
        appEvents.on(AppEvent.ViewChanged, ({ view }) => {
          ;(this.element as HTMLElement).hidden = view !== "editor";
        }),
      );
    }
    if (hasFunc(AppFunc.ToolbarQuickNav)) {
      this.boundKeyDown = this.onKeyDown.bind(this);
      this.boundKeyUp = this.onKeyUp.bind(this);
      document.addEventListener("keydown", this.boundKeyDown, true);
      document.addEventListener("keyup", this.boundKeyUp, true);
    }
    this.unsubs.push(
      appEvents.on(
        AppEvent.DirtyChanged,
        ({ count, bytes, singleDirtyPath, currentPath }) => {
          this.updateDirtyCounter(count, bytes, singleDirtyPath, currentPath);
          this.relayout();
        },
      ),
      appEvents.on(AppEvent.TextStateChanged, (state) => {
        this.updateTextState(state);
        this.relayout();
      }),
      appEvents.on(AppEvent.BlockContextChanged, ({ context }) => {
        this.updateBlockState(context);
        this.relayout();
      }),
      appEvents.on(AppEvent.HistoryChanged, ({ canUndo, canRedo }) => {
        this.setCommandDisabled(ToolbarCommand.Undo, !canUndo);
        this.setCommandDisabled(ToolbarCommand.Redo, !canRedo);
      }),
      appEvents.on(AppEvent.SourceModeToggled, () => {
        this.updateTextState(EMPTY_TEXT_STATE);
        this.updateBlockState(EMPTY_BLOCK_CONTEXT);
        this.relayout();
      }),
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        if (view !== "editor") {
          this.updateTextState(EMPTY_TEXT_STATE);
          this.updateBlockState(EMPTY_BLOCK_CONTEXT);
        }
        this.relayout();
      }),
    );

    this.element.addEventListener("menu-closed", this.onMenuClosed);
    this.element.addEventListener("menu-arrow", this.onMenuArrow);
    document.addEventListener("click", this.onDocClick);
  }

  disconnect() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
      if (!menuRegistry.get(name)) continue;
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      const title = label;
      // Pass the resolver (not the resolved array) so dynamic items — e.g. the
      // Recent Projects list — are re-read on every menu open.
      const menu = new Menu({
        mountEl: mount,
        label,
        title,
        items: () => menuRegistry.get(name)!,
        mnemonic,
      });
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
      const hadOpenMenu = this.hasOpenMenu();
      if (hadOpenMenu) this.closeAllMenus();
      const mount = nextEl.closest("[data-menu-name]");
      const mnemonic = mount?.getAttribute("data-menu-mnemonic")?.toLowerCase();
      if (hadOpenMenu && mnemonic) {
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
      !btn.closest(".toolbar-heading-dropdown") &&
      !btn.closest(".toolbar-list-dropdown") &&
      !btn.closest(".toolbar-overflow-dropdown")
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
    if (target.closest(".toolbar-overflow-dropdown")) {
      this.closeOverflowDropdown();
    } else if (target.closest(".toolbar-list-dropdown")) {
      this.closeListDropdown();
    }
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
      this.element
        .querySelector(".toolbar-list-dropdown")
        ?.classList.remove("open");
    }
    el?.classList.toggle("open");
  }

  execList(e: Event) {
    const target = (e.target as HTMLElement).closest(
      "[data-kind]",
    ) as HTMLElement | null;
    if (!target) return;
    const kind = target.dataset.kind;
    if (!kind) return;

    const command = LIST_KIND_COMMANDS[kind as ListKind];
    if (command === undefined) return;

    appEvents.emit(AppEvent.ToolbarCommandExec, { command });

    this.closeListDropdown();
  }

  toggleListDropdown() {
    const el = this.element.querySelector(
      ".toolbar-list-dropdown",
    ) as HTMLElement;
    const opening = !el?.classList.contains("open");
    if (opening) {
      document
        .querySelectorAll(".toolbar-menu.open")
        .forEach((m) => m.classList.remove("open"));
      this.element
        .querySelector(".toolbar-heading-dropdown")
        ?.classList.remove("open");
    }
    el?.classList.toggle("open");
  }

  toggleOverflowDropdown() {
    if (!this.hasOverflowDropdownTarget) return;
    const el = this.overflowDropdownTarget;
    if (this.overflowBtnTarget.hidden) return;
    const opening = !el.classList.contains("open");
    if (opening) {
      document
        .querySelectorAll(".toolbar-menu.open")
        .forEach((m) => m.classList.remove("open"));
      this.element
        .querySelector(".toolbar-heading-dropdown")
        ?.classList.remove("open");
      this.element.querySelector(".toolbar-list-dropdown")?.classList.remove("open");
    }
    el.classList.toggle("open");
  }

  toggleSidebar() {
    appEvents.emit(AppEvent.SidebarToggle);
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

  /**
   * Reflect the formatting state at the editor caret: mark buttons (b/i/s + link)
   * get `.active`, and the heading button shows the current level + highlights
   * the matching dropdown entry.
   */
  private updateTextState(state: TextState): void {
    this.setCommandActive(ToolbarCommand.Bold, state.bold);
    this.setCommandActive(ToolbarCommand.Italic, state.italic);
    this.setCommandActive(ToolbarCommand.Strike, state.strike);
    this.setCommandActive(ToolbarCommand.Code, state.code);
    this.setCommandActive(ToolbarCommand.Link, state.link);
    this.updateHeadingState(state.heading);
  }

  /**
   * Reflect the block-level state at the caret: quote lights up inside a
   * blockquote; the list dropdown trigger lights up inside any list and its
   * label icon + active items track the current list kind. The check/uncheck
   * item is only enabled inside a task list.
   */
  private updateBlockState(context: ActiveBlockContext): void {
    this.setCommandActive(
      ToolbarCommand.Blockquote,
      context.type === ActiveBlockType.Blockquote,
    );

    const inList =
      context.type === ActiveBlockType.BulletList ||
      context.type === ActiveBlockType.OrderedList ||
      context.type === ActiveBlockType.TaskList;
    const btn = this.element.querySelector<HTMLElement>(".toolbar-list-btn");
    btn?.classList.toggle("active", inList);
    if (btn) {
      const label = btn.querySelector<HTMLElement>(".list-label");
      if (label) {
        label.innerHTML =
          context.type === ActiveBlockType.OrderedList
            ? icons.numberedListLeft
            : context.type === ActiveBlockType.TaskList
              ? icons.checkSquare
              : icons.list;
      }
    }

    const currentKind =
      context.type === ActiveBlockType.BulletList
        ? "bullet"
        : context.type === ActiveBlockType.OrderedList
          ? "ordered"
          : context.type === ActiveBlockType.TaskList
            ? "task"
            : null;

    // The third dropdown slot is contextual: "Task list" when the block is NOT
    // a task list (convert to task), and "Checked/Unchecked Task List" when it
    // IS (toggles the CURRENT item's checked state — `checked` is the caret
    // item, so the label names the action that will apply to it).
    const taskSlot =
      this.element.querySelector<HTMLElement>(".toolbar-list-dropdown .toolbar-list-task");
    const isTask = context.type === ActiveBlockType.TaskList;
    if (taskSlot) {
      if (isTask) {
        taskSlot.dataset.kind = "checked";
        taskSlot.textContent =
          context.checked === true ? "Unchecked Task List" : "Checked Task List";
      } else {
        taskSlot.dataset.kind = "task";
        taskSlot.textContent = "Task list";
      }
    }

    // "Clear List Item": unwraps the touched list items back into non-lists.
    // Only meaningful while the caret (or selection) is inside a list, so it is
    // hidden outside them.
    const clearItem = this.element.querySelector<HTMLElement>(
      ".toolbar-list-dropdown .toolbar-list-clear",
    );
    if (clearItem) clearItem.hidden = !inList;

    this.element
      .querySelectorAll<HTMLElement>(".toolbar-list-dropdown [data-kind]")
      .forEach((el) => {
        const itemKind = el.dataset.kind;
        if (itemKind === "checked") {
          el.classList.toggle("active", isTask && context.checked === true);
          return;
        }
        el.classList.toggle("active", currentKind === itemKind);
      });
  }

  private setCommandActive(command: ToolbarCommand, active: boolean): void {
    const cmd = `${TOOLBAR_CMD_PREFIX}${command}`;
    this.element
      .querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`)
      .forEach((el) => {
        el.classList.toggle("active", active);
        el.setAttribute("aria-pressed", String(active));
      });
  }

  private setCommandDisabled(command: ToolbarCommand, disabled: boolean): void {
    const cmd = `${TOOLBAR_CMD_PREFIX}${command}`;
    this.element
      .querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`)
      .forEach((el) => {
        el.classList.toggle("is-disabled", disabled);
        if (disabled) {
          el.setAttribute("disabled", "");
          el.setAttribute("aria-disabled", "true");
        } else {
          el.removeAttribute("disabled");
          el.removeAttribute("aria-disabled");
        }
      });
  }

  private updateHeadingState(level: number): void {
    const btn = this.element.querySelector<HTMLElement>(".toolbar-heading-btn");
    const label = btn?.querySelector<HTMLElement>(".heading-label");
    if (label) label.textContent = level > 0 ? `H${level}` : "H";
    btn?.classList.toggle("active", level > 0);
    this.element
      .querySelectorAll<HTMLElement>(".toolbar-heading-dropdown button")
      .forEach((el) => {
        const isCurrent =
          level > 0 && parseInt(el.dataset.level ?? "0", 10) === level;
        el.classList.toggle("active", isCurrent);
        el.setAttribute("aria-current", isCurrent ? "true" : "false");
      });
  }

  private onDocClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const dropdown = this.element.querySelector(
      ".toolbar-heading-dropdown",
    ) as HTMLElement | null;
    if (
      dropdown?.classList.contains("open") &&
      !target.closest(".toolbar-heading-wrap")
    ) {
      dropdown.classList.remove("open");
    }
    const listDropdown = this.element.querySelector(
      ".toolbar-list-dropdown",
    ) as HTMLElement | null;
    if (
      listDropdown?.classList.contains("open") &&
      !target.closest(".toolbar-list-wrap")
    ) {
      listDropdown.classList.remove("open");
    }
    if (
      this.hasOverflowDropdownTarget &&
      this.overflowDropdownTarget.classList.contains("open") &&
      !target.closest(".toolbar-overflow-wrap")
    ) {
      this.overflowDropdownTarget.classList.remove("open");
    }
  };

  private closeHeadingDropdown() {
    const el = this.element.querySelector(
      ".toolbar-heading-dropdown",
    ) as HTMLElement | null;
    el?.classList.remove("open");
  }

  private closeListDropdown() {
    const el = this.element.querySelector(
      ".toolbar-list-dropdown",
    ) as HTMLElement | null;
    el?.classList.remove("open");
  }

  private updateDirtyCounter(
    count: number,
    bytes: number,
    singleDirtyPath?: string,
    currentPath?: string,
  ) {
    const el = this.dirtyCounterTarget;
    if (!el) return;

    el.classList.toggle("clickable", false);

    const hasDirty = count > 0;
    if (!hasDirty) {
      // Keep the last-rendered "X pending +Y B" content in the DOM (hidden) so
      // relayout can measure the dirty portion's real width at the current
      // viewport — the reservation must survive the counter hiding, or the
      // "…" overflow would let the dirty badge push the layout when it returns.
      el.style.display = "none";
      el.tabIndex = -1;
      this.flushBtnTarget.disabled = true;
      return;
    }

    el.style.display = "";
    el.textContent = "";
    el.tabIndex = 0;

    const isSingleCurrent =
      count === 1 && singleDirtyPath && singleDirtyPath === currentPath;

    if (isSingleCurrent && isMobileDock()) {
      // Current file only → compact eye + discard, no pending text.
      el.prepend(createChangesBtn());
      const btn = pressTwiceButton({
        idleText: "⟲",
        pendingText: "Press again",
        variant: "danger",
        small: true,
        idleBadge: bytes !== 0 ? `(${formatBytes(bytes)})` : undefined,
        onConfirm: () =>
          appEvents.emit(AppEvent.SingleDiscardRequested, {
            path: singleDirtyPath,
          }),
      });
      el.appendChild(btn);
    } else {
      // Multiple pending ops, or a single op on a non-current file → text.
      const badge =
        bytes !== 0
          ? `<span style="color:${bytes > 0 ? colors.green : colors.danger};font-size:0.7rem;margin-left:4px">${formatBytes(bytes)}</span>`
          : "";
      el.innerHTML = `<div style="display:flex;gap:6px;align-items:center"><span>${count} pending</span>${badge}</div>`;
      el.classList.toggle("clickable", true);
    }

    this.flushBtnTarget.disabled = false;
  }

  // ── Procedural overflow ──────────────────────────────────────────────

  /**
   * Measure the toolbar and hide every center-section item that does not
   * fit, moving the overflowed simple command buttons into the "…" dropdown.
   * Procedural: runs on every toolbar resize (ResizeObserver) and whenever
   * content that changes widths fires (dirty counter, heading/list labels).
   *
   * Reserved space (never allowed to overflow, so the layout never shifts):
   *  1. the right section's always-visible controls (flush + prefs),
   *  2. the dirty-counter portion — measured live from its last-rendered
   *     content (kept in the DOM while hidden) at the CURRENT viewport/zoom,
   *  3. the "…" trigger's own width — reserved while hidden too, so showing
   *     it on overflow costs nothing and never pushes sibling buttons.
   */
  private relayout(): void {
    if (!this.hasOverflowWrapTarget || !this.hasOverflowBtnTarget) return;
    const toolbar = this.element as HTMLElement;
    if (toolbar.hidden) return;
    const left = toolbar.querySelector<HTMLElement>(".toolbar-section-left");
    const center = toolbar.querySelector<HTMLElement>(".toolbar-section-center");
    const right = toolbar.querySelector<HTMLElement>(".toolbar-section-right");
    const sep = toolbar.querySelector<HTMLElement>(
      ".toolbar-section-left + .toolbar-sep",
    );
    if (!left || !center || !right || !sep) return;

    // Restore every item's natural width before measuring — previously-hidden
    // items would otherwise read 0 and break the fit loop.
    const items = Array.from(center.children).filter((el): el is HTMLElement =>
      el instanceof HTMLElement && el !== this.overflowWrapTarget
    );
    for (const el of items) el.hidden = false;

    const style = getComputedStyle(toolbar);
    const toolbarGap = parseFloat(style.gap) || 0;
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const toolbarInner = toolbar.clientWidth - padL - padR;

    // Right section's always-visible controls (the dirty counter is reserved
    // separately — it toggles visibility).
    let rightWidth = 0;
    let first = true;
    for (const el of Array.from(right.children)) {
      if (el === this.dirtyCounterTarget || !(el instanceof HTMLElement)) continue;
      rightWidth += el.offsetWidth + (first ? 0 : toolbarGap);
      first = false;
    }

    // The dirty portion: natural content width (last-rendered "X pending +Y B"
    // text, kept in the DOM while hidden) + its margin-right + the flex gap to
    // the flush button. Measured live so the reservation tracks the actual
    // content at whatever viewport/zoom the toolbar renders in.
    const dirtyEl = this.dirtyCounterTarget;
    const dirtyWidth =
      this.measureHiddenWidth(dirtyEl) +
      (parseFloat(getComputedStyle(dirtyEl).marginRight) || 0) +
      toolbarGap;

    // Toolbar-level gaps: left↔sep, sep↔center, center↔spacer, spacer↔right.
    const sepWidth = sep.offsetWidth;
    const room =
      toolbarInner -
      left.offsetWidth -
      sepWidth -
      toolbarGap * 4 -
      rightWidth -
      dirtyWidth -
      this.measureHiddenWidth(this.overflowBtnTarget);

    const gap = parseFloat(getComputedStyle(center).gap) || 0;
    let used = 0;
    let cut = items.length;
    for (let i = 0; i < items.length; i++) {
      const w = items[i].offsetWidth;
      if (used + w + (i > 0 ? gap : 0) <= room) {
        used += w + (i > 0 ? gap : 0);
      } else {
        cut = i;
        break;
      }
    }

    const visible = items.slice(0, cut);
    const overflowed = items.slice(cut);
    for (const el of visible) el.hidden = false;
    for (const el of overflowed) el.hidden = true;

    const key = overflowed.map((el) => items.indexOf(el)).join(",");
    if (overflowed.length > 0) {
      if (key !== this.lastOverflowKey) {
        this.lastOverflowKey = key;
        this.renderOverflowItems(overflowed);
      }
      this.overflowBtnTarget.hidden = false;
    } else {
      this.lastOverflowKey = "";
      this.overflowBtnTarget.hidden = true;
      this.overflowDropdownTarget.innerHTML = "";
      this.overflowDropdownTarget.classList.remove("open");
    }
  }

  /**
   * Clone the overflowed buttons into the "…" dropdown. Clones keep their
   * data-cmd / data-action so Stimulus dispatches the same commands; the
   * compound heading/list wraps and separators are dropped (their dropdowns
   * must stay anchored in the visible toolbar).
   */
  private renderOverflowItems(overflowed: HTMLElement[]): void {
    const dropdown = this.overflowDropdownTarget;
    dropdown.innerHTML = "";
    for (const el of overflowed) {
      if (
        el.classList.contains("toolbar-sep") ||
        el.classList.contains("toolbar-heading-wrap") ||
        el.classList.contains("toolbar-list-wrap")
      ) {
        continue;
      }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.hidden = false;
      dropdown.appendChild(clone);
    }
    if (!dropdown.firstChild) {
      dropdown.classList.remove("open");
    }
  }

  /**
   * Width an element occupies when shown: its natural content width plus the
   * surrounding spacing (flex gap + margins). Handles BOTH visibility hiding
   * styles — the `hidden` attribute (overflow trigger) and inline
   * `display: none` (dirty counter) — by temporarily restoring layout with
   * `visibility: hidden`, so the width is measured at the CURRENT zoom /
   * viewport instead of a stale cached value.
   */
  private measureHiddenWidth(el: HTMLElement): number {
    if (el.offsetWidth > 0) return el.offsetWidth;
    const prevDisplay = el.style.display;
    const prevVis = el.style.visibility;
    const wasHidden = el.hidden;
    el.style.visibility = "hidden";
    el.hidden = false;
    el.style.display = "";
    const w = el.offsetWidth;
    el.hidden = wasHidden;
    el.style.visibility = prevVis;
    el.style.display = prevDisplay;
    return w;
  }

  private closeOverflowDropdown(): void {
    if (this.hasOverflowDropdownTarget) {
      this.overflowDropdownTarget.classList.remove("open");
    }
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
