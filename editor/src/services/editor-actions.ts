import { confirmDialog, promptDialog, promptCreateDialog } from "@/components/dialogs/dialog"
import { serializeFrontmatter } from "@/utils/frontmatter"
import type { MetaPanelData } from "@/components/panels/meta-panel"
import { pageRepository } from "@/repositories/pageRepository"
import type { FileSyncController } from "@/controllers/file-sync-controller"
import { showNotification } from "@/components/notification/notification"
import { treeStore } from "@/stores/tree-store"
import { HOME_PATH, validateHugoSlug } from "@/utils/hugo-compat"

function dirIsEmpty(parentDir: string): boolean {
  const tree = treeStore.getTree()
  const children = parentDir
    ? (tree[parentDir] as Record<string, unknown> | undefined)
    : tree
  if (!children) return true
  return Object.keys(children).length === 0
}

export async function createNewItem(
  cacheService: FileSyncController,
  pagePath: string,
  doNavigate: (path: string) => void,
  loadSidebar: () => Promise<void>,
  isFolder?: boolean,
): Promise<void> {
  const parentDir = isFolder
    ? pagePath
    : pagePath.includes("/")
      ? pagePath.substring(0, pagePath.lastIndexOf("/"))
      : ""

  const isDirEmpty = dirIsEmpty(parentDir)
  const result = await promptCreateDialog("New", { defaultValue: isDirEmpty ? HOME_PATH : undefined })
  if (!result) return

  const slug = result.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
  if (!slug) return

  const slugError = validateHugoSlug(slug)
  if (slugError) {
    alert(slugError)
    return
  }

  if (result.asDirectory) {
    const dirPath = parentDir ? `${parentDir}/${slug}` : slug
    const indexPath = `${dirPath}/${HOME_PATH}`
    if (await cacheService.pathExists(indexPath)) {
      showNotification(`"${indexPath}" already exists.`, { title: "Duplicate", type: "warning" })
      return
    }
    const fmData: MetaPanelData = { title: result.name, weight: 100 }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(indexPath, content)
    const idxPage = pageRepository.getOrCreate(indexPath)
    idxPage.setFrontmatter(fmData)
    idxPage.bodyState.cacheBody(body)
    idxPage.setBaseline(body)

    await loadSidebar()
    doNavigate(indexPath)
  } else {
    const fullPath = parentDir ? `${parentDir}/${slug}` : slug
    if (await cacheService.pathExists(fullPath)) {
      showNotification(`"${fullPath}" already exists.`, { title: "Duplicate", type: "warning" })
      return
    }
    const fmData: MetaPanelData = { title: result.name, weight: 100 }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(fullPath, content)
    const fp = pageRepository.getOrCreate(fullPath)
    fp.setFrontmatter(fmData)
    fp.bodyState.cacheBody(body)
    fp.setBaseline(body)

    await loadSidebar()
    doNavigate(fullPath)
  }
}

export async function deletePage(
  cacheService: FileSyncController,
  pagePath: string,
  afterDelete: () => void
): Promise<boolean> {
  const confirmed = await confirmDialog({
    title: "Delete page",
    message: `Are you sure you want to delete "${pagePath}"? This operation must be flushed to take effect.`,
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
  })
  if (!confirmed) return false

  cacheService.queueDelete(pagePath)
  afterDelete()
  return true
}

export async function renamePage(
  cacheService: FileSyncController,
  pagePath: string,
  afterRename: (newPath: string | null) => void,
  validateSlug?: (slug: string, parentDir: string) => string | null | Promise<string | null>,
): Promise<void> {
  const name = prompt("New name:")
  if (!name) return

  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
  if (!slug) return

  const slugError = validateHugoSlug(slug)
  if (slugError) {
    alert(slugError)
    return
  }

  const parentDir = pagePath.includes("/")
    ? pagePath.substring(0, pagePath.lastIndexOf("/"))
    : ""

  const error = await validateSlug?.(slug, parentDir)
  if (error) {
    alert(error)
    return
  }

  const newPath = parentDir ? `${parentDir}/${slug}` : slug

  cacheService.queueRename(pagePath, newPath)
  afterRename(newPath)
}

export async function createDirectory(
  cacheService: FileSyncController,
  parentPath: string,
  doNavigate: (path: string) => void,
  loadSidebar: () => Promise<void>
): Promise<void> {
  const name = await promptDialog({
    title: "New Directory",
    label: "Directory name:",
    placeholder: "My Section",
  })
  if (!name) return

  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
  if (!slug) return

  const slugError = validateHugoSlug(slug)
  if (slugError) {
    alert(slugError)
    return
  }

  const dirPath = parentPath ? `${parentPath}/${slug}` : slug
  const indexPath = `${dirPath}/_index`
  const fmData: MetaPanelData = { title: name, weight: 100 }
  const fmStr = serializeFrontmatter(fmData)
  const body = `# ${name}\n\n`
  const content = `---\n${fmStr}\n---\n\n${body}`

  cacheService.queueCreate(indexPath, content)
  const idp = pageRepository.getOrCreate(indexPath)
  idp.setFrontmatter(fmData)
  idp.bodyState.cacheBody(body)
  idp.setBaseline(body)

  await loadSidebar()
  doNavigate(indexPath)
}

export async function movePage(
  cacheService: FileSyncController,
  from: string,
  to: string,
  afterMove: () => void
): Promise<void> {
  if (from === to) return
  cacheService.queueMove(from, to)
  afterMove()
}
