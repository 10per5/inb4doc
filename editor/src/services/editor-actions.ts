import { confirmDialog, promptDialog, promptCreateDialog } from "@/components/dialogs/dialog"
import { serializeFrontmatter } from "@/utils/frontmatter"
import type { MetaPanelData } from "@/components/panels/meta-panel"
import { pageRepository } from "@/repositories/pageRepository"
import type { FileSyncController } from "@/controllers/file-sync-controller"
import { showNotification } from "@/components/notification/notification"
import { treeStore } from "@/stores/tree-store"
import { HOME_PATH, HOME_FILENAME, validateHugoSlug } from "@/utils/hugo-compat"
import type { TreeIndex } from "@/utils/tree"

function dirIsEmpty(parentDir: string): boolean {
  const tree = treeStore.getTree()
  const entries = tree.children.get(parentDir)
  return !entries || entries.length === 0
}

function findCaseInsensitiveFile(tree: TreeIndex, parentDir: string, slug: string): string | null {
  const lowerSlug = slug.toLowerCase()
  const entries = tree.children.get(parentDir) ?? []
  for (const entry of entries) {
    if (entry.isDir) continue
    const base = entry.name.replace(/\.md$/, "")
    if (base.toLowerCase() === lowerSlug && base !== HOME_FILENAME) {
      return entry.name
    }
  }
  return null
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

    const tree = treeStore.getTree()
    const conflictingFile = findCaseInsensitiveFile(tree, parentDir, slug)

    if (conflictingFile) {
      const existingPath = parentDir ? `${parentDir}/${conflictingFile.replace(/\.md$/, "")}` : conflictingFile.replace(/\.md$/, "")
      const confirmed = await confirmDialog({
        title: "Convert to directory?",
        message: `"${conflictingFile.replace(/\.md$/, "")}" already exists as a file. Convert it to a directory? The file contents will become the directory's index page.`,
        confirmLabel: "Convert",
      })
      if (!confirmed) return

      const existingPage = pageRepository.get(existingPath)
      let existingBody = existingPage?.bodyState.body ?? existingPage?.bodyState.baseline
      let existingFm = existingPage?.getFrontmatter()

      if (existingBody === undefined) {
        const provider = (await import("@/stores/provider-store")).getProvider()
        const raw = await provider?.readFile(existingPath)
        if (raw) {
          const { stripFrontmatter } = await import("@/utils/frontmatter")
          const parsed = stripFrontmatter(raw)
          existingBody = parsed.body
          existingFm = parsed.frontmatter ?? undefined
        }
      }

      if (existingBody === undefined) existingBody = ""

      const fmData: MetaPanelData = existingFm
        ? { ...existingFm, title: (existingFm as MetaPanelData).title ?? result.name, weight: (existingFm as MetaPanelData).weight ?? 100 }
        : { title: result.name, weight: 100 }
      const fmStr = serializeFrontmatter(fmData)
      const content = `---\n${fmStr}\n---\n\n${existingBody}`

      cacheService.queueDelete(existingPath)
      cacheService.queueCreate(indexPath, content)
      const idxPage = pageRepository.getOrCreate(indexPath)
      idxPage.setFrontmatter(fmData)
      idxPage.bodyState.cacheBody(existingBody)
      idxPage.setBaseline(existingBody)
      pageRepository.clearPath(existingPath)

      await loadSidebar()
      doNavigate(indexPath)
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
  const indexPath = `${dirPath}/${HOME_PATH}`

  if (await cacheService.pathExists(indexPath)) {
    showNotification(`"${indexPath}" already exists.`, { title: "Duplicate", type: "warning" })
    return
  }

  const tree = treeStore.getTree()
  const conflictingFile = findCaseInsensitiveFile(tree, parentPath, slug)

  if (conflictingFile) {
    const existingPath = parentPath ? `${parentPath}/${conflictingFile.replace(/\.md$/, "")}` : conflictingFile.replace(/\.md$/, "")
    const confirmed = await confirmDialog({
      title: "Convert to directory?",
      message: `"${conflictingFile.replace(/\.md$/, "")}" already exists as a file. Convert it to a directory? The file contents will become the directory's index page.`,
      confirmLabel: "Convert",
    })
    if (!confirmed) return

    const existingPage = pageRepository.get(existingPath)
    let existingBody = existingPage?.bodyState.body ?? existingPage?.bodyState.baseline
    let existingFm = existingPage?.getFrontmatter()

    if (existingBody === undefined) {
      const provider = (await import("@/stores/provider-store")).getProvider()
      const raw = await provider?.readFile(existingPath)
      if (raw) {
        const { stripFrontmatter } = await import("@/utils/frontmatter")
        const parsed = stripFrontmatter(raw)
        existingBody = parsed.body
        existingFm = parsed.frontmatter ?? undefined
      }
    }

    if (existingBody === undefined) existingBody = ""

    const fmData: MetaPanelData = existingFm
      ? { ...existingFm, title: (existingFm as MetaPanelData).title ?? name, weight: (existingFm as MetaPanelData).weight ?? 100 }
      : { title: name, weight: 100 }
    const fmStr = serializeFrontmatter(fmData)
    const content = `---\n${fmStr}\n---\n\n${existingBody}`

    cacheService.queueDelete(existingPath)
    cacheService.queueCreate(indexPath, content)
    const idxPage = pageRepository.getOrCreate(indexPath)
    idxPage.setFrontmatter(fmData)
    idxPage.bodyState.cacheBody(existingBody)
    idxPage.setBaseline(existingBody)
    pageRepository.clearPath(existingPath)

    await loadSidebar()
    doNavigate(indexPath)
    return
  }

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
