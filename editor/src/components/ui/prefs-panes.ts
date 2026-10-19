import * as icons from "@/eta/icons"
import { appVersion } from "@/config"
import { prefsStore } from "@/stores/preferences-store"
import { treeStore } from "@/stores/tree-store"
import { pagesStore } from "@/stores/page-store"
import { getProvider, getProviderDisplayInfo } from "@/stores/provider-store"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { SPELL_LANGUAGES } from "@/config/spell-languages"
import {
  PrefsSection,
  PREFS_SECTION_ORDER,
  prefsSections,
  PREFS_SECTION_PREFIX,
} from "@/config/enums/prefs-section"
import { HOME_FILENAME } from "@/utils/hugo-compat"
import renderGeneral from "@/eta/views/prefs/section-general"
import renderEditor from "@/eta/views/prefs/section-editor"
import renderNavigation from "@/eta/views/prefs/section-navigation"
import renderStorage from "@/eta/views/prefs/section-storage"

const ICONS = icons as unknown as Record<string, string>

export interface PrefsPane {
  section: PrefsSection
  label: string
  description: string
  icon: string
  html: string
  active: boolean
}

/** Root-level folders — the "projects" the navigation section can scope to. */
export interface RootFolder {
  path: string
  label: string
  count: number
}

function prettifySlug(name: string): string {
  return name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function folderLabel(path: string): string {
  const name = path.includes("/") ? path.split("/").pop()! : path
  const title = pagesStore.get(`${path}/${HOME_FILENAME}`)?.getFrontmatter?.()?.title
  return title || prettifySlug(name)
}

function countPagesUnder(root: string): number {
  const prefix = `${root}/`
  let n = 0
  for (const p of treeStore.getTree().paths) {
    if (p.startsWith(prefix)) n++
  }
  return n
}

export function getRootFolders(): RootFolder[] {
  const children = treeStore.getTree().children.get("") ?? []
  return children
    .filter((c) => c.isDir)
    .map((c) => ({
      path: c.path,
      label: folderLabel(c.path),
      count: countPagesUnder(c.path),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Render every preferences section into markup. Both the desktop tabbed dialog
 * and the mobile per-section screens read these so there is exactly one copy of
 * the field markup and exactly one set of `data-action` names.
 */
export function buildPrefsPanes(active: PrefsSection, controller = "prefs"): PrefsPane[] {
  const prefs = prefsStore.prefs
  const provider = getProvider()
  const info = getProviderDisplayInfo(provider.name)
  const rootFolders = getRootFolders()

  const htmlFor: Record<PrefsSection, string> = {
    [PrefsSection.General]: renderGeneral({ prefs, controller, icons: ICONS }),
    [PrefsSection.Editor]: renderEditor({
      prefs,
      controller,
      icons: ICONS,
      languages: SPELL_LANGUAGES,
    }),
    [PrefsSection.Navigation]: renderNavigation({
      prefs,
      controller,
      icons: ICONS,
      rootFolders,
      canOpenProject: hasFunc(AppFunc.ProjectPicker),
    }),
    [PrefsSection.Storage]: renderStorage({
      prefs,
      controller,
      icons: ICONS,
      providerLabel: info.label,
      providerIcon: info.icon,
      rootLabel: "",
      cachedPages: pagesStore.size,
    }),
  }

  return PREFS_SECTION_ORDER.map((section) => {
    const meta = prefsSections[section]
    return {
      section,
      label: meta.label,
      description: meta.description,
      icon: ICONS[meta.icon] ?? "",
      html: htmlFor[section],
      active: section === active,
    }
  })
}

export interface AboutLink {
  href: string
  title: string
  subtitle: string
  icon: string
}

/**
 * Links shown in the About window. The documentation link resolves to the
 * published wiki when the build knows its base URL.
 */
export function buildAboutLinks(liveUrl: string): AboutLink[] {
  return [
    {
      href: liveUrl || "https://10per5.github.io/inb4doc/",
      title: "Documentation",
      subtitle: "The published inb4doc wiki",
      icon: icons.bookStack,
    },
    {
      href: "https://github.com/10per5/inb4doc",
      title: "GitHub",
      subtitle: "Source, issues and releases",
      icon: icons.github,
    },
  ]
}

export const aboutVersion = appVersion

export { PREFS_SECTION_PREFIX, PrefsSection }
