import * as icons from "@/eta/icons"
import { BaseDialogController } from "./dialog/base-dialog-controller"
import { prefsStore } from "@/stores/preferences-store"
import type { ImageStorageMode } from "@/services/storage-service"
import {
  onPrefsStickyChanged,
  onPrefsDarkChanged,
  onPrefsImageModeChanged,
  onPrefsHideEmptyFoldersChanged,
  onPrefsRootScopeChanged,
  onPrefsSpellcheckChanged,
  onPrefsSpellcheckLanguagesChanged,
  onPrefsCustomCssChanged,
  onPrefsFollowCaretToolbarChanged,
  onPrefsPinnedProjectsChanged,
} from "@/components/ui/prefs"
import { buildPrefsPanes } from "@/components/ui/prefs-panes"
import { appEvents, AppEvent } from "@/stores/app-events"
import { openWindow } from "@/services/window-service"
import { renderScreen } from "@/eta/views/screen"
import renderPrefsWindow from "@/eta/views/window/prefs-window"
import renderPrefsScreen from "@/eta/views/controller/prefs-screen"
import {
  PrefsSection,
  PREFS_SECTION_PREFIX,
  DEFAULT_PREFS_SECTION,
  parsePrefsSection,
} from "@/config/enums/prefs-section"

// One controller per feature: registered as `prefs`, it renders the desktop
// preferences window when the element carries a payload (window-service mounts
// data-prefs-payload-value) and the mobile fullview otherwise. On mobile the
// screen first shows a menu of sections; picking one pushes that section's
// fields (tabs don't survive the phone layout, so each tab becomes a screen).
//
// On desktop it is the root of the window stack: a window opened from one of
// its panes (Storage → Change… → storage backend) pushes onto that stack, so
// Cancel/Accept returns here — to the section the user was reading — instead of
// dropping back to the editor.
export default class PrefsController extends BaseDialogController {
  static values = { payload: Object, section: String }
  static targets = [
    "pane",
    "tab",
    "langChips",
    "projectBadge",
    "projectMore",
    "projectTable",
    "projectRow",
    "projectPrevPage",
    "projectNextPage",
    "projectPageLabel",
  ]

  declare payloadValue: {
    section?: PrefsSection
  }

  declare sectionValue: string

  // Stimulus generates these runtime getters from `static values`; the shipped
  // types don't (dialogs always carried a payload before the merge).
  declare readonly hasPayloadValue: boolean
  declare readonly hasSectionValue: boolean
  declare readonly paneTargets: HTMLElement[]
  declare readonly tabTargets: HTMLElement[]
  // Stimulus names the plural-presence getter SINGULAR: target "pane" gives
  // `paneTargets` (all) but `hasPaneTarget` (presence) — there is no
  // `hasPaneTargets`, and reading it yields `undefined`, silently skipping work.
  declare readonly hasPaneTarget: boolean
  declare readonly hasLangChipsTarget: boolean
  declare readonly langChipsTarget: HTMLElement
  declare readonly hasProjectMoreTarget: boolean
  declare readonly projectMoreTarget: HTMLElement
  declare readonly hasProjectTableTarget: boolean
  declare readonly projectTableTarget: HTMLElement
  declare readonly projectBadgeTargets: HTMLElement[]
  declare readonly projectRowTargets: HTMLElement[]
  declare readonly hasProjectPrevPageTarget: boolean
  declare readonly projectPrevPageTarget: HTMLButtonElement
  declare readonly hasProjectNextPageTarget: boolean
  declare readonly projectNextPageTarget: HTMLButtonElement
  declare readonly hasProjectPageLabelTarget: boolean
  declare readonly projectPageLabelTarget: HTMLElement

  private unsubs: (() => void)[] = []
  /** Section the window was rendered with — kept so a resume redraw stays put. */
  private openedSection: PrefsSection = DEFAULT_PREFS_SECTION

  disconnect(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    super.disconnect()
  }

  connect(): void {
    if (this.hasPayloadValue) {
      this.openedSection =
        parsePrefsSection(String(this.payloadValue?.section ?? "")) ??
        DEFAULT_PREFS_SECTION
      this.watchWindowResume()
      this.renderDialog(this.openedSection)
      return
    }
    this.watchViewChanges()
    this.watchBackRequests()
    this.renderScreen(this.currentSection())
  }

  /**
   * A pushed section screen owns the first back press: it steps back to the
   * preferences menu instead of the host leaving the app. Without a section
   * there is nothing to unwind and the event stays unhandled.
   */
  private watchBackRequests(): void {
    this.unsubs.push(
      appEvents.on(AppEvent.BackRequested, (request) => {
        if (this.hasPayloadValue) return
        if (this.currentSection() === null) return
        this.backToMenu()
        request.handled = true
      }),
    )
  }

  // ── Desktop ────────────────────────────────────────────────────────

  private renderDialog(active: PrefsSection): void {
    this.element.innerHTML = renderPrefsWindow({
      PREFS_SECTION_PREFIX,
      icons: icons as Record<string, string>,
      panes: buildPrefsPanes(active),
    })
  }

  /**
   * A child window (storage backend) closing over us means the world may have
   * moved on: the Storage pane reports the active provider, so redraw to keep
   * the label honest. The redraw is why the last-opened section is remembered
   * on every tab switch instead of being pure DOM state.
   */
  private watchWindowResume(): void {
    if (!this.hasPayloadValue) return
    this.unsubs.push(
      appEvents.on(AppEvent.WindowResumed, ({ id }) => {
        if (id !== "prefs") return
        this.renderDialog(this.currentDialogSection())
      }),
    )
  }

  private currentDialogSection(): PrefsSection {
    const active = this.tabTargets.find((el) => el.classList.contains("is-active"))
    return parsePrefsSection(active?.dataset.section ?? "") ?? this.openedSection
  }

  switchTab(event: Event): void {
    const target = event.currentTarget as HTMLElement
    const section = parsePrefsSection(target.dataset.section ?? "")
    if (section === null) return
    this.openedSection = section
    if (!this.hasPaneTarget) return
    // Panes stay laid out (stacked in one grid cell) and are only made
    // invisible, so the window keeps the size of the tallest section instead of
    // growing and shrinking on every tab switch.
    for (const el of this.paneTargets) {
      const on = el.dataset.section === `${PREFS_SECTION_PREFIX}${section}`
      el.classList.toggle("is-inactive", !on)
      el.setAttribute("aria-hidden", on ? "false" : "true")
    }
    for (const el of this.tabTargets) {
      const on = el.dataset.section === `${PREFS_SECTION_PREFIX}${section}`
      el.classList.toggle("is-active", on)
      el.setAttribute("aria-selected", on ? "true" : "false")
    }
  }

  // ── Mobile ─────────────────────────────────────────────────────────

  private currentSection(): PrefsSection | null {
    if (!this.hasSectionValue) return null
    return parsePrefsSection(this.sectionValue)
  }

  // Leaving the preferences screen resets it to the section menu, so coming
  // back later starts from the list instead of the leaf screen you left.
  private watchViewChanges(): void {
    if (this.hasPayloadValue) return
    this.unsubs.push(
      appEvents.on(AppEvent.ViewChanged, ({ view }) => {
        if (view === "prefs") return
        if (this.currentSection() === null) return
        this.sectionValue = ""
        this.renderScreen(null)
      }),
    )
  }

  private renderScreen(section: PrefsSection | null): void {
    this.element.innerHTML = renderPrefsScreen({
      PREFS_SECTION_PREFIX,
      PREFS_SECTION_PREFIX_LEN: PREFS_SECTION_PREFIX.length,
      section,
      icons: icons as Record<string, string>,
      renderScreen,
      panes: buildPrefsPanes(section ?? DEFAULT_PREFS_SECTION),
    })
  }

  openSection(event: Event): void {
    const target = event.currentTarget as HTMLElement
    const section = parsePrefsSection(target.dataset.section ?? "")
    if (section === null) return
    this.openSectionValue(section)
  }

  /** Programmatic entry — the shell uses this to jump straight to a section. */
  openSectionValue(section: PrefsSection): void {
    this.sectionValue = `${PREFS_SECTION_PREFIX}${section}`
    this.renderScreen(section)
  }

  backToMenu(): void {
    this.sectionValue = ""
    this.renderScreen(null)
  }

  // ── Shared ─────────────────────────────────────────────────────────

  close(): void {
    if (this.hasPayloadValue) {
      this.cancel()
      return
    }
    if (this.currentSection() !== null) {
      this.backToMenu()
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: "editor" })
  }

  // ── Field handlers ─────────────────────────────────────────────────

  stickyChanged(e: Event): void {
    onPrefsStickyChanged((e.target as HTMLInputElement).checked)
  }

  darkChanged(e: Event): void {
    onPrefsDarkChanged((e.target as HTMLInputElement).checked)
  }

  imageModeChanged(e: Event): void {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsImageModeChanged(radio.value as ImageStorageMode)
  }

  hideEmptyChanged(e: Event): void {
    onPrefsHideEmptyFoldersChanged((e.target as HTMLInputElement).checked)
  }

  // ── Project picker ────────────────────────────────────────────────

  /**
   * The picker is a switch, not a form field: picking a project retargets the
   * tree and closes whatever surface rendered it (dialog / mobile screen) so
   * the new files show through instead of sitting behind the panel.
   */
  projectPicked(e: Event): void {
    this.applyProject((e.currentTarget as HTMLElement).dataset.projectValue ?? "")
  }

  /** Rows are focusable (role=button), so Enter/Space must activate them too. */
  projectRowKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    this.applyProject((e.currentTarget as HTMLElement).dataset.projectValue ?? "")
  }

  private applyProject(value: string): void {
    onPrefsRootScopeChanged(value)
    this.syncProjectSelection(value)
    this.collapseProjectTable()
    this.close()
  }

  toggleProjectTable(): void {
    if (!this.hasProjectTableTarget) return
    if (this.projectTableTarget.hidden) this.showProjectPage(0)
    else this.collapseProjectTable()
  }

  projectPrevPage(): void {
    this.showProjectPage(this.currentProjectPage() - 1)
  }

  projectNextPage(): void {
    this.showProjectPage(this.currentProjectPage() + 1)
  }

  /**
   * Star/unstar a root-level project ("Show all" has no pin). The row itself is
   * a switch that would retarget the tree, so the click is swallowed here; and
   * because pinning reorders the list, the surface is redrawn instead of having
   * its DOM patched.
   */
  pinToggled(e: Event): void {
    e.stopPropagation()
    const value = (e.currentTarget as HTMLElement).dataset.projectValue ?? ""
    if (!value) return
    const pinned = prefsStore.pinnedProjects.filter((p) => p !== value)
    if (pinned.length === prefsStore.pinnedProjects.length) pinned.push(value)
    onPrefsPinnedProjectsChanged(pinned)
    this.redraw()
  }

  private redraw(): void {
    if (this.hasPayloadValue) {
      this.renderDialog(this.currentDialogSection())
      return
    }
    this.renderScreen(this.currentSection())
  }

  private currentProjectPage(): number {
    if (!this.hasProjectTableTarget) return 0
    return Number(this.projectTableTarget.dataset.page ?? "0")
  }

  private showProjectPage(page: number): void {
    if (!this.hasProjectTableTarget) return
    const pages = Math.max(1, Number(this.projectTableTarget.dataset.pageCount ?? "1"))
    const next = Math.min(Math.max(page, 0), pages - 1)
    this.projectTableTarget.dataset.page = String(next)
    this.projectTableTarget.hidden = false
    if (this.hasProjectMoreTarget) {
      // The disclosure swaps itself out for the table: while the table is open
      // "More…" would be a dead badge, so it only comes back on collapse.
      this.projectMoreTarget.hidden = true
      this.projectMoreTarget.setAttribute("aria-expanded", "true")
    }
    for (const row of this.projectRowTargets) {
      row.hidden = row.dataset.page !== String(next)
    }
    if (this.hasProjectPageLabelTarget) {
      this.projectPageLabelTarget.textContent = `${next + 1} / ${pages}`
    }
    if (this.hasProjectPrevPageTarget) this.projectPrevPageTarget.disabled = next === 0
    if (this.hasProjectNextPageTarget) this.projectNextPageTarget.disabled = next >= pages - 1
  }

  private collapseProjectTable(): void {
    if (!this.hasProjectTableTarget) return
    this.projectTableTarget.hidden = true
    if (this.hasProjectMoreTarget) {
      this.projectMoreTarget.hidden = false
      this.projectMoreTarget.setAttribute("aria-expanded", "false")
    }
  }

  private syncProjectSelection(value: string): void {
    for (const badge of this.projectBadgeTargets) {
      const on = (badge.dataset.projectValue ?? "") === value
      badge.classList.toggle("is-active", on)
      badge.setAttribute("aria-pressed", on ? "true" : "false")
    }
    for (const row of this.projectRowTargets) {
      row.classList.toggle("is-active", (row.dataset.projectValue ?? "") === value)
    }
  }

  toolbarPlacementChanged(e: Event): void {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsFollowCaretToolbarChanged(radio.value === "follow")
  }

  customCssChanged(e: Event): void {
    onPrefsCustomCssChanged((e.target as HTMLTextAreaElement).value)
  }

  spellcheckChanged(e: Event): void {
    const enabled = (e.target as HTMLInputElement).checked
    onPrefsSpellcheckChanged(enabled)
    // Language chips are meaningless without the highlight; keep their
    // enabled state in sync without rebuilding the pane (that would drop
    // focus mid-interaction). The chip list only exists in the Editor pane.
    if (!this.hasLangChipsTarget) return
    for (const input of this.languageInputs()) input.disabled = !enabled
  }

  spellLanguageChanged(): void {
    const tags = this.languageInputs()
      .filter((i) => i.checked)
      .map((i) => i.value)
    onPrefsSpellcheckLanguagesChanged(tags)
  }

  private languageInputs(): HTMLInputElement[] {
    if (!this.hasLangChipsTarget) return []
    return Array.from(
      this.langChipsTarget.querySelectorAll<HTMLInputElement>("input"),
    )
  }

  openProject(): void {
    appEvents.emit(AppEvent.OpenProjectRequested)
  }

  changeProvider(): void {
    appEvents.emit(AppEvent.ProviderChangeRequested)
  }
}

/** Window facade — used by shell_controller's desktop path. */
export function openPrefsWindow(section: PrefsSection = DEFAULT_PREFS_SECTION): void {
  openWindow("prefs", { section }, { title: "Preferences", boxClass: "prefs-dialog" })
}

export { PrefsSection, DEFAULT_PREFS_SECTION }
