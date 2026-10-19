/**
 * Preferences are split into sections. Each section renders its own form and,
 * on desktop, is one tab of the centered preferences dialog; on mobile each
 * section is its own fullview screen reachable from the preferences menu.
 *
 * The int-based enum follows the `data-action` convention documented in
 * AGENTS.md (`PREFIX${EnumInt}`), so switching tabs stays a single handler.
 */
export const PREFS_SECTION_PREFIX = "pf-";

export enum PrefsSection {
  General,
  Editor,
  Navigation,
  Storage,
}

export interface PrefsSectionMeta {
  id: string;
  label: string;
  description: string;
  /** Icon export name in `src/eta/icons.ts` (kebab iconoir → camelCase). */
  icon: string;
}

export const prefsSections: Record<PrefsSection, PrefsSectionMeta> = {
  [PrefsSection.General]: {
    id: "general",
    label: "General",
    description: "Appearance and window behaviour.",
    icon: "settings",
  },
  [PrefsSection.Editor]: {
    id: "editor",
    label: "Editor",
    description: "Editing toolbar and writing assistance.",
    icon: "editPencil",
  },
  [PrefsSection.Navigation]: {
    id: "navigation",
    label: "Navigation",
    description: "What the file tree shows.",
    icon: "bookStack",
  },
  [PrefsSection.Storage]: {
    id: "storage",
    label: "Storage",
    description: "Where documents and images are kept.",
    icon: "hardDrive",
  },
};

export const PREFS_SECTION_ORDER: PrefsSection[] = [
  PrefsSection.General,
  PrefsSection.Editor,
  PrefsSection.Navigation,
  PrefsSection.Storage,
];

export function parsePrefsSection(value: string): PrefsSection | null {
  const n = Number(String(value).replace(PREFS_SECTION_PREFIX, ""));
  return PREFS_SECTION_ORDER.includes(n) ? n : null;
}

/** Default landing tab of the preferences window. */
export const DEFAULT_PREFS_SECTION = PrefsSection.General;
