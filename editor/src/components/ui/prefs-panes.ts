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
  /** Starred in the project picker — pinned folders sort first. */
  pinned: boolean
}

/** A selectable project scope: one root-level folder, or "" for all of them. */
export interface ProjectOption {
  value: string
  label: string
  count: number
}

/** A row of the "More…" table — a project option plus the page it lands on. */
export interface ProjectRow extends ProjectOption {
  page: number
  pinned: boolean
}

// The project picker shows a few badge-shaped shortcuts and keeps the long
// tail in a paginated table, so a content root with hundreds of top-level
// folders never grows an unbounded list.
export const PROJECT_BADGE_LIMIT = 4
export const PROJECT_PAGE_SIZE = 8

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

/**
 * The folders that get a badge. The active project always gets one even when
 * it sorts outside the first N — otherwise picking it from the table would
 * leave the badge row looking unset.
 */
export function pickBadgeFolders(
  folders: RootFolder[],
  selected: string,
  limit = PROJECT_BADGE_LIMIT,
): RootFolder[] {
  const head = folders.slice(0, limit)
  if (!selected) return head
  if (head.some((f) => f.path === selected)) return head
  const chosen = folders.find((f) => f.path === selected)
  if (!chosen) return head
  return [...head.slice(0, limit - 1), chosen]
}

/** Table rows: "Show all" first, then every root-level folder, paginated.
 *
 * The table stays alphabetical on purpose: it is also where projects get
 * starred, and re-sorting rows under the pointer made starring a couple of
 * them a game of chase. Pinned projects still lead the badge row (see
 * `getRootFolders`); only the badges are order-sensitive. */
export function buildProjectRows(folders: RootFolder[], totalCount: number): ProjectRow[] {
  const alphabetical = [...folders].sort((a, b) => a.label.localeCompare(b.label))
  const rows: ProjectOption[] = [
    { value: "", label: "Show all", count: totalCount },
    ...alphabetical.map((f) => ({ value: f.path, label: f.label, count: f.count })),
  ]
  return rows.map((row, i) => ({
    ...row,
    page: Math.floor(i / PROJECT_PAGE_SIZE),
    pinned: row.value !== "" && alphabetical.find((f) => f.path === row.value)?.pinned === true,
  }))
}

/**
 * Root-level folders with their star state. Starred projects come first (then
 * alphabetically), so a pinned project never falls off the badge row no matter
 * how many top-level folders the content root has.
 */
export function getRootFolders(): RootFolder[] {
  const pinned = new Set(prefsStore.pinnedProjects)
  const children = treeStore.getTree().children.get("") ?? []
  return children
    .filter((c) => c.isDir)
    .map((c) => ({
      path: c.path,
      label: folderLabel(c.path),
      count: countPagesUnder(c.path),
      pinned: pinned.has(c.path),
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.label.localeCompare(b.label)
    })
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
      badgeFolders: pickBadgeFolders(rootFolders, prefs.rootScope),
      projectRows: buildProjectRows(rootFolders, treeStore.getTree().paths.size),
      projectPages: Math.max(
        1,
        Math.ceil((rootFolders.length + 1) / PROJECT_PAGE_SIZE),
      ),
      hasProjectTable: rootFolders.length > 0,
      rootFolderCount: rootFolders.length,
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
