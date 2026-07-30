import { PendingOpType, type PendingOp } from "@/entities/PendingOps"

export type { PendingOp }
export { PendingOpType }

/** Default weight for files/dirs without frontmatter weight (JSON-serializable Infinity). */
export const DEFAULT_WEIGHT = 1_000_000

export interface ChildInfo {
  name: string       // "guide.md" or "subdir"
  path: string       // "docs/guide" (no .md extension)
  isDir: boolean
  weight: number     // from frontmatter, or DEFAULT_WEIGHT
}

export interface TreeIndex {
  paths: Set<string>
  children: Map<string, ChildInfo[]>
  folderWeights: Map<string, number>
  fileWeights: Map<string, number>
}

export function createEmptyTreeIndex(): TreeIndex {
  return {
    paths: new Set(),
    children: new Map(),
    folderWeights: new Map(),
    fileWeights: new Map(),
  }
}

function getParentPrefix(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

export function sortChildren(children: ChildInfo[]): ChildInfo[] {
  return children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.weight - b.weight || a.name.localeCompare(b.name)
  })
}

function upsertChildForPath(tree: TreeIndex, path: string): void {
  const parent = getParentPrefix(path)
  const name = path.slice(parent.length ? parent.length + 1 : 0)
  const weight = tree.fileWeights.get(path) ?? DEFAULT_WEIGHT

  let children = tree.children.get(parent)
  if (!children) {
    tree.children.set(parent, [{ name: name + ".md", path, isDir: false, weight }])
    return
  }

  const idx = children.findIndex(c => c.path === path)
  if (idx !== -1) {
    if (children[idx].weight === weight) return
    children[idx] = { name: name + ".md", path, isDir: false, weight }
  } else {
    children.push({ name: name + ".md", path, isDir: false, weight })
  }
  sortChildren(children)
}

function ensureAncestorDirectories(tree: TreeIndex, path: string): void {
  const parts = path.split("/")
  for (let i = 1; i < parts.length; i++) {
    const dirPath = parts.slice(0, i).join("/")
    const parentPrefix = parts.slice(0, i - 1).join("/")
    const dirName = parts[i - 1]

    let children = tree.children.get(parentPrefix)
    if (!children) {
      const weight = tree.folderWeights.get(dirPath) ?? DEFAULT_WEIGHT
      tree.children.set(parentPrefix, [{ name: dirName, path: dirPath, isDir: true, weight }])
      continue
    }

    if (children.some(c => c.isDir && c.path === dirPath)) continue

    const weight = tree.folderWeights.get(dirPath) ?? DEFAULT_WEIGHT
    children.push({ name: dirName, path: dirPath, isDir: true, weight })
    sortChildren(children)
  }
}

export function addPathToTree(tree: TreeIndex, path: string): void {
  if (!tree.paths.has(path)) {
    tree.paths.add(path)
  }
  upsertChildForPath(tree, path)
  ensureAncestorDirectories(tree, path)
}

export function removePathFromTree(tree: TreeIndex, path: string): void {
  // Remove all descendant paths
  const descendants = [...tree.paths].filter(p => p === path || p.startsWith(path + "/"))
  if (descendants.length === 0 && !tree.paths.has(path)) return

  for (const p of descendants) {
    tree.paths.delete(p)
    const parent = getParentPrefix(p)
    const children = tree.children.get(parent)
    if (children) {
      const idx = children.findIndex(c => c.path === p)
      if (idx !== -1) children.splice(idx, 1)
      if (children.length === 0) tree.children.delete(parent)
    }
  }

  // Clean up empty ancestor directories
  const parts = (descendants.length > 0 ? descendants[0] : path).split("/")
  for (let i = parts.length - 1; i > 0; i--) {
    const dirPath = parts.slice(0, i).join("/")
    const grandParent = parts.slice(0, i - 1).join("/")

    const hasAny = [...tree.paths].some(p => {
      const pParent = getParentPrefix(p)
      return pParent === dirPath || p.startsWith(dirPath + "/")
    })
    if (hasAny) break

    const gpChildren = tree.children.get(grandParent)
    if (gpChildren) {
      const dirIdx = gpChildren.findIndex(c => c.isDir && c.path === dirPath)
      if (dirIdx !== -1) gpChildren.splice(dirIdx, 1)
      if (gpChildren.length === 0) tree.children.delete(grandParent)
    }
  }
}

export function buildTreeIndex(data: {
  paths: string[]
  children: Record<string, { name: string; path: string; isDir: boolean; weight: number }[]>
  folderWeights: Record<string, number>
  fileWeights?: Record<string, number>
}): TreeIndex {
  const tree = createEmptyTreeIndex()
  for (const p of data.paths) tree.paths.add(p)
  for (const [k, v] of Object.entries(data.folderWeights)) tree.folderWeights.set(k, v)
  for (const [k, v] of Object.entries(data.fileWeights ?? {})) tree.fileWeights.set(k, v)

  for (const [prefix, entries] of Object.entries(data.children)) {
    tree.children.set(prefix, entries.map(e => ({ ...e })))
  }

  // Client-side providers (LocalStorage, FileSystem) pass empty children{}.
  // Build children incrementally from paths.
  if (!tree.children.has("")) {
    for (const path of tree.paths) {
      addPathToTree(tree, path)
    }
  }

  return tree
}

/**
 * Return up to `max` sibling files from the same directory as `path`,
 * excluding `path` itself. Returns display paths (no `.md` extension).
 */
export function getNeighbors(tree: TreeIndex, path: string, max = 2): string[] {
  const parts = path.split("/")
  if (parts.length < 2) return []
  const parentPrefix = parts.slice(0, -1).join("/")
  const siblings = tree.children.get(parentPrefix) ?? []
  return siblings
    .filter(c => !c.isDir && c.path !== path)
    .slice(0, max)
    .map(c => c.path)
}

function collectChildrenFromTree(tree: TreeIndex, prefix: string): { dirs: string[]; files: string[] } {
  const entries = tree.children.get(prefix) ?? []
  const dirs = entries.filter(c => c.isDir).map(c => c.path)
  const files = entries.filter(c => !c.isDir).map(c => c.path)
  return { dirs, files }
}

/**
 * Return up to `max` suggested paths for the no-file view.
 *
 * When `lastPath` is a directory → its children (dirs first, then files).
 *
 * When `lastPath` is a file (e.g. `docs/guide`):
 *   1. Children of the directory containing the file
 *   2. Parent directory's other children
 *
 * When `lastPath` is empty → top-level dirs, then files.
 */
export function getSuggestions(tree: TreeIndex, lastPath: string, max = 3): string[] {
  if (tree.paths.size === 0) return []

  if (!lastPath) {
    const { dirs, files } = collectChildrenFromTree(tree, "")
    return [...dirs.slice(0, max), ...files.slice(0, max - dirs.length)].slice(0, max)
  }

  const dirChildren = tree.children.get(lastPath)
  if (dirChildren && dirChildren.length > 0) {
    const dirs = dirChildren.filter(c => c.isDir).map(c => c.path)
    const files = dirChildren.filter(c => !c.isDir).map(c => c.path)
    return [...dirs.slice(0, max), ...files.slice(0, max - dirs.length)].slice(0, max)
  }

  const fileParts = lastPath.split("/")
  const parentPrefix = fileParts.slice(0, -1).join("/")
  const result: string[] = []

  const parentChildren = tree.children.get(parentPrefix) ?? []
  const filteredDirs = parentChildren.filter(c => c.isDir && c.path !== lastPath)
  const filteredFiles = parentChildren.filter(c => !c.isDir && c.path !== lastPath)
  result.push(
    ...filteredDirs.slice(0, max).map(c => c.path),
    ...filteredFiles.slice(0, max - filteredDirs.length).map(c => c.path),
  )

  if (result.length >= max) return result.slice(0, max)

  if (fileParts.length > 1) {
    const grandParentPrefix = fileParts.slice(0, -2).join("/")
    const currentDirName = fileParts[fileParts.length - 2]
    const grandParentChildren = tree.children.get(grandParentPrefix) ?? []
    for (const child of grandParentChildren) {
      if (result.length >= max) break
      if (child.name === currentDirName || child.name === currentDirName + ".md") continue
      if (!result.includes(child.path)) result.push(child.path)
    }
  }

  return result.slice(0, max)
}

export function applyPendingOps(tree: TreeIndex, ops: readonly PendingOp[]): TreeIndex {
  if (ops.length === 0) return tree

  const result: TreeIndex = {
    paths: new Set(tree.paths),
    children: new Map([...tree.children].map(([k, v]) => [k, [...v]])),
    folderWeights: new Map(tree.folderWeights),
    fileWeights: new Map(tree.fileWeights),
  }

  for (const op of ops) {
    switch (op.type) {
      case PendingOpType.Create:
        addPathToTree(result, op.path)
        break
      case PendingOpType.Delete:
        break
      case PendingOpType.Rename:
        break
      case PendingOpType.Move:
        removePathFromTree(result, op.from)
        addPathToTree(result, op.to)
        break
    }
  }
  return result
}
