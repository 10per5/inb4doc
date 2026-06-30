import { confirmDialog, promptDialog, promptCreateDialog } from "./components/dialogs/dialog"
import { serializeFrontmatter } from "./utils/frontmatter"
import type { MetaPanelData } from "./components/panels/meta-panel"
import { cache } from "./cache"
import type { CacheManagementService } from "./services/cache-management-service"

export async function createNewItem(
  cacheService: CacheManagementService,
  pagePath: string,
  doNavigate: (path: string) => void,
  loadSidebar: () => Promise<void>
): Promise<void> {
  const result = await promptCreateDialog("New")
  if (!result) return

  const slug = result.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
  if (!slug) return

  if (slug.startsWith("_") && slug !== "_index") {
    alert('Only "_index" is allowed as a name starting with "_".')
    return
  }

  // Create as sibling (same directory as the clicked item)
  const parentDir = pagePath.includes("/")
    ? pagePath.substring(0, pagePath.lastIndexOf("/"))
    : ""

  if (result.asDirectory) {
    const dirPath = parentDir ? `${parentDir}/${slug}` : slug
    const indexPath = `${dirPath}/_index`
    const fmData: MetaPanelData = { title: result.name, weight: 100 }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(indexPath, content)
    cache.setFrontmatter(indexPath, fmData)
    cache.cacheBody(indexPath, body)
    cache.setBaseline(indexPath, body)

    await loadSidebar()
    doNavigate(indexPath)
  } else {
    const fullPath = parentDir ? `${parentDir}/${slug}` : slug
    const fmData: MetaPanelData = { title: result.name, weight: 100 }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(fullPath, content)
    cache.setFrontmatter(fullPath, fmData)
    cache.cacheBody(fullPath, body)
    cache.setBaseline(fullPath, body)

    await loadSidebar()
    doNavigate(fullPath)
  }
}

export async function deletePage(
  cacheService: CacheManagementService,
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
  cacheService: CacheManagementService,
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

  if (slug.startsWith("_") && slug !== "_index") {
    alert('Only "_index" is allowed as a name starting with "_".')
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
  cacheService: CacheManagementService,
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

  if (slug.startsWith("_") && slug !== "_index") {
    alert('Only "_index" is allowed as a name starting with "_".')
    return
  }

  const dirPath = parentPath ? `${parentPath}/${slug}` : slug
  const indexPath = `${dirPath}/_index`
  const fmData: MetaPanelData = { title: name, weight: 100 }
  const fmStr = serializeFrontmatter(fmData)
  const body = `# ${name}\n\n`
  const content = `---\n${fmStr}\n---\n\n${body}`

  cacheService.queueCreate(indexPath, content)
  cache.setFrontmatter(indexPath, fmData)
  cache.cacheBody(indexPath, body)
  cache.setBaseline(indexPath, body)

  await loadSidebar()
  doNavigate(indexPath)
}

export async function movePage(
  cacheService: CacheManagementService,
  from: string,
  to: string,
  afterMove: () => void
): Promise<void> {
  if (from === to) return
  cacheService.queueMove(from, to)
  afterMove()
}
