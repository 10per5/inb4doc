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
  onPrefsFollowCaretToolbarChanged,
} from "@/components/ui/prefs"
import { buildPrefsPanes } from "@/components/ui/prefs-panes"
import { appEvents, AppEvent } from "@/stores/app-events"
import { openDialog } from "@/services/dialog-service"
import { renderScreen } from "@/eta/views/screen"
import renderPrefsDialog from "@/eta/views/dialog/prefs-dialog"
import renderPrefsScreen from "@/eta/views/controller/prefs-screen"
import {
  PrefsSection,
  PREFS_SECTION_PREFIX,
  DEFAULT_PREFS_SECTION,
  parsePrefsSection,
} from "@/config/enums/prefs-section"

// One controller per feature: registered as `prefs`, it renders the desktop
// tabbed dialog when the element carries a payload (dialog-service mounts
// data-prefs-payload-value) and the mobile fullview otherwise. On mobile the
// screen first shows a menu of sections; picking one pushes that section's
// fields (tabs don't survive the phone layout, so each tab becomes a screen).
export default class PrefsController extends BaseDialogController {
  static values = { payload: Object, section: String }
  static targets = ["pane", "tab", "langChips"]

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
  declare readonly hasPaneTargets: boolean
  declare readonly hasLangChipsTarget: boolean
  declare readonly langChipsTarget: HTMLElement

  private unsubs: (() => void)[] = []

  disconnect(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    super.disconnect()
  }

  connect(): void {
    if (this.hasPayloadValue) {
      this.renderDialog(
        parsePrefsSection(String(this.payloadValue?.section ?? "")) ??
          DEFAULT_PREFS_SECTION,
      )
      return
    }
    this.watchViewChanges()
    this.renderScreen(this.currentSection())
  }

  // ── Desktop ────────────────────────────────────────────────────────

  private renderDialog(active: PrefsSection): void {
    this.element.innerHTML = renderPrefsDialog({
      PREFS_SECTION_PREFIX,
      icons: icons as Record<string, string>,
      panes: buildPrefsPanes(active),
    })
  }

  switchTab(event: Event): void {
    const target = event.currentTarget as HTMLElement
    const section = parsePrefsSection(target.dataset.section ?? "")
    if (section === null) return
    if (!this.hasPaneTargets) return
    for (const el of this.paneTargets) {
      el.hidden = el.dataset.section !== `${PREFS_SECTION_PREFIX}${section}`
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
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
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

  rootScopeChanged(e: Event): void {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsRootScopeChanged(radio.value)
  }

  toolbarPlacementChanged(e: Event): void {
    const radio = e.target as HTMLInputElement
    if (radio.checked) onPrefsFollowCaretToolbarChanged(radio.value === "follow")
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

/** Dialog facade — used by shell_controller's desktop path. */
export function openPrefsDialog(section: PrefsSection = DEFAULT_PREFS_SECTION): void {
  openDialog("prefs", { section })
}

export { PrefsSection, DEFAULT_PREFS_SECTION }
