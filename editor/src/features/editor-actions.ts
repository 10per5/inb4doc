import { confirmDialog, promptDialog, promptCreateDialog } from "@/controllers/dialog/dialog"
import { serializeFrontmatter, stripFrontmatter } from "@/utils/frontmatter"
import type { MetaPanelData } from "@/entities/Frontmatter"
import { Frontmatter } from "@/entities/Frontmatter"
import { pagesStore } from "@/stores/page-store"
import type { FileSyncService } from "@/services/file-sync-service"
import { showNotification } from "@/components/notification/notification"
import { appEvents, AppEvent } from "@/stores/app-events"
import { treeStore } from "@/stores/tree-store"
import { clearFileClipboard, getFileClipboard, setFileClipboard } from "@/stores/file-clipboard"
import { pendingOpsStore } from "@/stores/pending-ops-store"
import { dirtyTrackingService } from "@/services/dirty-tracking-service"
import { HOME_PATH, HOME_FILENAME, validateHugoSlug } from "@/utils/hugo-compat"
import { randomSlug, markAutoNamed } from "@/features/auto-name"
import { WEIGHT_STEP, type TreeIndex } from "@/utils/tree"
import { PendingOpType } from "@/entities/PendingOps"

/** Weight for a new sibling: the folder's current last item + WEIGHT_STEP. */
function nextFolderWeight(parentDir: string): number {
  const entries = treeStore.getTree().children.get(parentDir)
  if (!entries || entries.length === 0) return WEIGHT_STEP
  let max = -Infinity
  for (const e of entries) {
    if (e.weight > max) max = e.weight
  }
  return max + WEIGHT_STEP
}

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

// Same as above, but for an existing DIRECTORY with the same name. Creating a
// file whose name collides with a folder is illegal (the filesystem can't hold
// both), so the create flow rejects it up front, like a real OS.
function findCaseInsensitiveDir(tree: TreeIndex, parentDir: string, slug: string): string | null {
  const lowerSlug = slug.toLowerCase()
  const entries = tree.children.get(parentDir) ?? []
  for (const entry of entries) {
    if (!entry.isDir) continue
    if (entry.name.toLowerCase() === lowerSlug) {
      return entry.name
    }
  }
  return null
}

export async function createNewItem(
  cacheService: FileSyncService,
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

    // Block a directory whose name already matches an existing folder
    // (case-insensitive) — duplicate folder names are illegal.
    const existingDir = findCaseInsensitiveDir(treeStore.getTree(), parentDir, slug)
    if (existingDir) {
      showNotification(
        `A folder named "${existingDir}" already exists. Pick a different name.`,
        { title: "Name conflict", type: "warning" },
      )
      return
    }

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

      const existingPage = pagesStore.get(existingPath)
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

      cacheService.queueMove(existingPath, indexPath, content)
      const idxPage = pagesStore.getOrCreate(indexPath)
      idxPage.setFrontmatter(fmData)
      idxPage.bodyState.cacheBody(existingBody)
      idxPage.setBaseline(existingBody)
      pagesStore.clearPath(existingPath)

      await loadSidebar()
      doNavigate(indexPath)
      return
    }

    const fmData: MetaPanelData = { title: result.name, weight: nextFolderWeight(parentDir) }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(indexPath, content)
    const idxPage = pagesStore.getOrCreate(indexPath)
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

    // A file cannot share a name with an existing folder (the underlying
    // filesystem can't hold both); reject up front with a clear message
    // instead of failing to save later.
    const existingDir = findCaseInsensitiveDir(treeStore.getTree(), parentDir, slug)
    if (existingDir) {
      showNotification(
        `A folder named "${existingDir}" already exists. A file can't share that name — pick a different name.`,
        { title: "Name conflict", type: "warning" },
      )
      return
    }
    const fmData: MetaPanelData = { title: result.name, weight: nextFolderWeight(parentDir) }
    const fmStr = serializeFrontmatter(fmData)
    const body = `# ${result.name}\n\n`
    const content = `---\n${fmStr}\n---\n\n${body}`

    cacheService.queueCreate(fullPath, content)
    const fp = pagesStore.getOrCreate(fullPath)
    fp.setFrontmatter(fmData)
    fp.bodyState.cacheBody(body)
    fp.setBaseline(body)

    await loadSidebar()
    doNavigate(fullPath)
  }
}

export async function deletePages(
  cacheService: FileSyncService,
  pagePaths: string[],
  afterDelete: () => void
): Promise<boolean> {
  if (pagePaths.length === 0) return false

  const title = pagePaths.length === 1 ? "Delete page" : "Delete pages"
  const what = pagePaths.length === 1
    ? `Are you sure you want to delete "${pagePaths[0]}"?`
    : `Are you sure you want to delete ${pagePaths.length} pages (${pagePaths.slice(0, 5).map(p => `"${p}"`).join(", ")}${pagePaths.length > 5 ? ` and ${pagePaths.length - 5} more` : ""})?`
  const confirmed = await confirmDialog({
    title,
    message: `${what} This operation must be flushed to take effect.`,
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
  })
  if (!confirmed) return false

  cacheService.queueDeleteMany(pagePaths)
  afterDelete()
  return true
}

export async function renamePage(
  cacheService: FileSyncService,
  pagePath: string,
  afterRename: (newPath: string | null) => void,
  validateSlug?: (slug: string, parentDir: string) => string | null | Promise<string | null>,
): Promise<void> {
  const currentTitle = pagePath.split("/").pop() || ""
  const result = await promptDialog({
    title: "Rename page",
    label: "New name:",
    placeholder: "My Page",
    value: currentTitle,
    confirmLabel: "Rename",
  })
  if (!result) return

  const slug = result
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

  dirtyTrackingService.flush()
  cacheService.queueRename(pagePath, newPath)
  afterRename(newPath)
}

/**
 * Rename a whole directory. A folder has no file of its own, so this queues a
 * Rename for every page underneath it (all sharing the `folderRename` marker
 * the sidebar uses to style the folder row). Nothing moves until a flush; the
 * old paths stay readable/clickable in the meantime, exactly like a file
 * rename.
 */
export async function renameFolder(
  cacheService: FileSyncService,
  folderPath: string,
  afterRename: (newPath: string | null) => void,
): Promise<void> {
  const currentName = folderPath.split("/").pop() || folderPath
  const result = await promptDialog({
    title: "Rename folder",
    label: "New name:",
    placeholder: currentName,
    value: currentName,
    confirmLabel: "Rename",
  })
  if (!result) return

  const slug = result
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
  if (!slug) return

  const slugError = validateHugoSlug(slug)
  if (slugError) {
    alert(slugError)
    return
  }

  const parentDir = folderPath.includes("/")
    ? folderPath.substring(0, folderPath.lastIndexOf("/"))
    : ""
  const newPath = parentDir ? `${parentDir}/${slug}` : slug
  if (newPath === folderPath) return

  const tree = treeStore.getTree()
  const ops = cacheService.getPendingOps()
  const previewTree = ops.applyToTree(tree)

  const treeConflict = [...previewTree.paths].some(
    (path) => path === newPath || path.startsWith(`${newPath}/`),
  )
  if (treeConflict) {
    showNotification(`"${slug}" already exists here.`, {
      title: "Name conflict",
      type: "warning",
    })
    return
  }

  const existingDir = findCaseInsensitiveDir(previewTree, parentDir, slug)
  if (existingDir && existingDir !== currentName) {
    showNotification(`A folder named "${existingDir}" already exists.`, {
      title: "Name conflict",
      type: "warning",
    })
    return
  }
  const existingFile = findCaseInsensitiveFile(previewTree, parentDir, slug)
  if (existingFile) {
    showNotification(`A file named "${existingFile}" already exists there.`, {
      title: "Name conflict",
      type: "warning",
    })
    return
  }
  const conflict = ops.all.find((op) => {
    if (op.type === PendingOpType.Create) {
      return op.path === newPath || op.path.startsWith(`${newPath}/`)
    }
    if (op.type === PendingOpType.Rename || op.type === PendingOpType.Move) {
      return op.to === newPath || op.to.startsWith(`${newPath}/`)
    }
    return false
  })
  if (conflict) {
    showNotification(`"${slug}" is already queued as another location.`, {
      title: "Name conflict",
      type: "warning",
    })
    return
  }

  const members = [...previewTree.paths].filter(
    (path) => path.startsWith(`${folderPath}/`) && !ops.hasPendingDelete(path),
  )
  if (members.length === 0) {
    showNotification("This folder has no pages to rename.", {
      title: "Rename folder",
      type: "warning",
    })
    return
  }

  // Fold any debounced body edit into the pending ops first, so each rename
  // carries the latest text instead of a stale cached body.
  dirtyTrackingService.flush()
  for (const from of members) {
    const to = `${newPath}${from.slice(folderPath.length)}`
    cacheService.queueRename(from, to, folderPath)
  }
  afterRename(newPath)
}

export async function createDirectory(
  cacheService: FileSyncService,
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

    const existingPage = pagesStore.get(existingPath)
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

    cacheService.queueMove(existingPath, indexPath, content)
    const idxPage = pagesStore.getOrCreate(indexPath)
    idxPage.setFrontmatter(fmData)
    idxPage.bodyState.cacheBody(existingBody)
    idxPage.setBaseline(existingBody)
    pagesStore.clearPath(existingPath)

    await loadSidebar()
    doNavigate(indexPath)
    return
  }

  const fmData: MetaPanelData = { title: name, weight: nextFolderWeight(parentPath) }
  const fmStr = serializeFrontmatter(fmData)
  const body = `# ${name}\n\n`
  const content = `---\n${fmStr}\n---\n\n${body}`

  cacheService.queueCreate(indexPath, content)
  const idp = pagesStore.getOrCreate(indexPath)
  idp.setFrontmatter(fmData)
  idp.bodyState.cacheBody(body)
  idp.setBaseline(body)

  await loadSidebar()
  doNavigate(indexPath)
}

/**
 * Create a page without asking for a name: it lands under a throwaway
 * three-word slug and takes its real name from the first `# heading` (see
 * features/auto-name). Same pending-Create plumbing as the prompted flow, so
 * nothing reaches disk until a flush.
 */
export async function createQuickPage(
  cacheService: FileSyncService,
  parentPath: string,
  doNavigate: (path: string) => Promise<void> | void,
  loadSidebar: () => Promise<void>,
): Promise<boolean> {
  const parentDir = parentPath || ""
  let fullPath = ""
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = randomSlug()
    const candidate = parentDir ? `${parentDir}/${base}` : base
    if (!(await cacheService.pathExists(candidate))) {
      fullPath = candidate
      break
    }
  }
  if (!fullPath) {
    showNotification("Could not find a free name", { title: "New", type: "warning" })
    return false
  }

  // No title on purpose: the name comes from the first line (see
  // features/auto-name), so the frontmatter only carries the sort weight.

  const fmData: MetaPanelData = { title: "", weight: nextFolderWeight(parentDir) }

  const fmStr = serializeFrontmatter(fmData)
  // A bare H1 with no title yet: the caret lands where the title goes and
  // typing it renames the file (see features/auto-name).
  const body = "#\n"
  const content = `---\n${fmStr}\n---\n\n${body}`

  cacheService.queueCreate(fullPath, content)
  const page = pagesStore.getOrCreate(fullPath)
  page.setFrontmatter(fmData)
  page.bodyState.cacheBody(body)
  page.setBaseline(body)
  markAutoNamed(fullPath)

  await loadSidebar()
  await doNavigate(fullPath)
  return true
}

/**
 * Full content for `path` (frontmatter + body), preferring whatever the pending
 * ops say about it so a queued Create/Edit is what gets copied, not the older
 * copy still sitting on disk. Falls back to the page store, then to disk.
 */
async function readFullContent(
  cacheService: FileSyncService,
  path: string,
): Promise<string | undefined> {
  const ops = cacheService.getPendingOps()
  const createOp = ops.findCreate(path)
  if (createOp) return createOp.content

  const page = pagesStore.get(path)
  if (page?.bodyState.body !== undefined && ops.findEdit(path)) {
    return page.reconstructContent()
  }
  if (page?.bodyState.body !== undefined) return page.reconstructContent()

  const provider = (await import("@/stores/provider-store")).getProvider()
  const raw = await provider?.readFile(path)
  return raw ?? undefined
}

/** Next free `<base>-copy` (then `-copy-2`, …) that nothing else occupies. */
async function uniqueCopyPath(
  cacheService: FileSyncService,
  base: string,
): Promise<string> {
  let candidate = `${base}-copy`
  let n = 2
  while (await cacheService.pathExists(candidate)) {
    candidate = `${base}-copy-${n}`
    n++
  }
  return candidate
}

/**
 * Duplicate one page — or a whole directory (its `_index` plus every
 * descendant). Each copy is queued as a pending Create, so nothing reaches
 * disk until a flush: the copies show up in Pending Changes like any new file
 * and a discarded duplicate never touches the folder.
 */
export async function duplicatePages(
  cacheService: FileSyncService,
  paths: string[],
  afterDuplicate: (created: string[]) => void,
): Promise<void> {
  if (paths.length === 0) return

  const tree = treeStore.getTree()
  const created: string[] = []

  for (const sourcePath of paths) {
    // A directory duplicates as a unit: itself plus everything beneath it.
    const isDir = !tree.paths.has(sourcePath)
    const members = isDir
      ? [...tree.paths].filter(
          (p) => p === sourcePath || p.startsWith(`${sourcePath}/`),
        )
      : [sourcePath]
    if (members.length === 0) members.push(sourcePath)

    const targetRoot = await uniqueCopyPath(cacheService, sourcePath)

    for (const member of members) {
      const content = await readFullContent(cacheService, member)
      if (content === undefined) continue
      const targetPath =
        member === sourcePath
          ? targetRoot
          : `${targetRoot}${member.slice(sourcePath.length)}`
      cacheService.queueCreate(targetPath, content)

      const { frontmatter, body } = stripFrontmatter(content)
      const page = pagesStore.getOrCreate(targetPath)
      if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter)
      page.bodyState.cacheBody(body)
      page.setBaseline(body)
      created.push(targetPath)
    }
  }

  if (created.length === 0) {
    showNotification("Nothing to duplicate", { title: "Duplicate", type: "warning" })
    return
  }
  afterDuplicate(created)
}

/**
 * Cut one page into the file clipboard: its contents travel with the cursor and
 * the original is queued for deletion — the same pending Delete the menu's
 * Delete queues, so the row strikes through and nothing leaves the folder until
 * a flush. Pasting re-creates the document elsewhere; saving with nothing
 * pasted is simply the delete.
 */
export async function cutPage(
  cacheService: FileSyncService,
  path: string,
  afterCut: (path: string) => void,
): Promise<void> {
  const content = await readFullContent(cacheService, path)
  if (content === undefined) {
    showNotification("Nothing to cut", { title: "Cut", type: "warning", id: "file-cut" })
    return
  }

  setFileClipboard({ path, content, mode: "cut" })
  cacheService.queueDelete(path)
  afterCut(path)
  showNotification(`Cut "${path.split("/").pop() ?? path}" — paste it, then save`, {
    title: "Cut",
    type: "info",
    id: "file-cut",
  })
}

/**
 * Paste the file clipboard's document back as a new page. A folder target
 * receives it inside itself, a page target next to itself; the original name is
 * kept, falling back to `-copy` only when something already sits there.
 */
export async function pastePage(
  cacheService: FileSyncService,
  target: string,
  afterPaste: (created: string) => void,
): Promise<void> {
  const entry = getFileClipboard()
  if (!entry) {
    showNotification("Nothing to paste", { title: "Paste", type: "warning", id: "file-paste" })
    return
  }

  const tree = treeStore.getTree()
  const base = entry.path.split("/").pop() ?? entry.path
  const dir = tree.paths.has(target) ? target.slice(0, Math.max(0, target.lastIndexOf("/"))) : target
  let targetPath = dir ? `${dir}/${base}` : base
  if (await cacheService.pathExists(targetPath)) {
    let n = 2
    while (await cacheService.pathExists(`${targetPath}-${n}`)) n++
    targetPath = `${targetPath}-${n}`
  }

  cacheService.queueCreate(targetPath, entry.content)

  const { frontmatter, body } = stripFrontmatter(entry.content)
  const page = pagesStore.getOrCreate(targetPath)
  if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter)
  page.bodyState.cacheBody(body)
  page.setBaseline(body)

  clearFileClipboard()
  afterPaste(targetPath)
}

/**
 * Wipe a page's body, keeping its frontmatter. Queued as a pending Edit with
 * an empty patch, so it is reviewable (the diff shows every line removed) and
 * only reaches disk on flush — the same guarantee Delete gives. For a
 * directory this empties its `_index` page.
 */
export async function clearPageContents(
  cacheService: FileSyncService,
  paths: string[],
  afterClear: (cleared: string[]) => void,
): Promise<void> {
  if (paths.length === 0) return

  const tree = treeStore.getTree()
  const targets = paths.map((p) => (tree.paths.has(p) ? p : `${p}/${HOME_PATH}`))

  const what =
    targets.length === 1
      ? `Remove all content from "${targets[0]}"? The frontmatter is kept.`
      : `Remove all content from ${targets.length} pages? The frontmatter is kept.`
  const confirmed = await confirmDialog({
    title: "Clear content",
    message: `${what} This operation must be flushed to take effect.`,
    confirmLabel: "Clear",
    confirmClass: "danger",
  })
  if (!confirmed) return

  const cleared: string[] = []
  for (const path of targets) {
    const page = pagesStore.getOrCreate(path)
    if (page.bodyState.body === undefined) await page.flushIn()
    if ((page.bodyState.body ?? "").trim() === "") continue

    // Keep the baseline so the pending-changes diff shows what disappeared;
    // an empty patch is a valid Edit (never skip it with a truthiness check).
    page.setBody("")
    cacheService.queueEdit(path, "")
    cleared.push(path)
  }

  if (cleared.length === 0) {
    showNotification("Already empty", { title: "Clear content", type: "info" })
    return
  }
  afterClear(cleared)
}

export async function movePage(
  cacheService: FileSyncService,
  from: string,
  to: string,
  afterMove: () => void
): Promise<void> {
  if (from === to) return
  cacheService.queueMove(from, to)
  afterMove()
}

/**
 * Reorder a page by writing a new frontmatter `weight` through the pending-Edit
 * pipeline (same shape the meta panel produces, so it appears in the pending
 * changes dialog and flushes like any metadata edit).
 *
 * `path` is the file that carries the weight — for a folder reorder that is the
 * folder's `_index` page.
 */
export async function setPageWeights(
  cacheService: FileSyncService,
  weights: { path: string; weight: number }[],
  after: () => void
): Promise<void> {
  for (const w of weights) {
    await queuePageWeight(cacheService, w.path, w.weight)
  }
  pendingOpsStore.save(cacheService.getPendingOps().all)
  dirtyTrackingService.recompute()
  appEvents.emit(AppEvent.MetaPanelReload)
  after()
}

async function queuePageWeight(
  cacheService: FileSyncService,
  path: string,
  weight: number
): Promise<void> {
  const page = pagesStore.getOrCreate(path)
  const ops = cacheService.getPendingOps()

  if (page.bodyState.body === undefined) {
    const ok = await page.flushIn()
    if (!ok && !ops.hasPendingCreate(path)) return
  }

  const data: MetaPanelData = {
    ...(page.getFrontmatter() ?? ({ title: "" } as MetaPanelData)),
    weight,
  }
  page.frontmatter = Frontmatter.fromMeta(data)

  const createOp = ops.findCreate(path)
  const renameOp = ops.findRename(path)
  if (createOp) {
    ops.queueCreate(path, page.reconstructContent() ?? "")
  } else if (renameOp) {
    // Keep the pending rename; metadata changes ride along in its content.
    renameOp.content = page.reconstructContent() ?? renameOp.content ?? ""
  } else {
    const editOp = ops.findEdit(path)
    const originalWeight = page.originalFrontmatter?.weight
    if (originalWeight === weight) {
      if (editOp) {
        const fp = { ...(editOp.frontmatterPatch ?? {}) }
        delete fp.weight
        if (Object.keys(fp).length === 0) {
          if (editOp.patch === (page.bodyState.baseline ?? "")) {
            ops.remove(path)
          } else {
            editOp.frontmatterPatch = undefined
          }
        } else {
          editOp.frontmatterPatch = fp
        }
      }
    } else if (editOp) {
      editOp.frontmatterPatch = { ...(editOp.frontmatterPatch ?? {}), weight }
    } else {
      ops.queueEdit(path, page.bodyState.body ?? "", { weight })
    }
  }
}
