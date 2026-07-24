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
  /** All known page paths (without .md extension) */
  paths: Set<string>
  /** Parent prefix → children sorted by weight (dirs first, then files) */
  children: Map<string, ChildInfo[]>
  /** Folder weights (from _index.md frontmatter) */
  folderWeights: Map<string, number>
}

export function createEmptyTreeIndex(): TreeIndex {
  return {
    paths: new Set(),
    children: new Map(),
    folderWeights: new Map(),
  }
}

function getParentPrefix(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

function sortChildren(children: ChildInfo[]): ChildInfo[] {
  return children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.weight - b.weight || a.name.localeCompare(b.name)
  })
}

function rebuildChildrenForPrefix(tree: TreeIndex, prefix: string): void {
  const children: ChildInfo[] = []

  // Collect files in this directory
  for (const path of tree.paths) {
    const parent = getParentPrefix(path)
    if (parent !== prefix) continue
    const name = path.slice(prefix.length ? prefix.length + 1 : 0)
    if (name.includes("/")) continue // nested path, not a direct child
    children.push({
      name: name + ".md",
      path,
      isDir: false,
      weight: DEFAULT_WEIGHT,
    })
  }

  // Collect subdirectories
  const seenDirs = new Set<string>()
  for (const path of tree.paths) {
    if (!path.startsWith(prefix ? prefix + "/" : "")) continue
    const rel = path.slice(prefix ? prefix.length + 1 : 0)
    const slash = rel.indexOf("/")
    if (slash === -1) continue // direct child file, already handled
    const dirName = rel.slice(0, slash)
    if (seenDirs.has(dirName)) continue
    seenDirs.add(dirName)
    const dirPath = prefix ? `${prefix}/${dirName}` : dirName
    const weight = tree.folderWeights.get(dirPath) ?? DEFAULT_WEIGHT
    children.push({
      name: dirName,
      path: dirPath,
      isDir: true,
      weight,
    })
  }

  tree.children.set(prefix, sortChildren(children))
}

export function buildTreeIndex(data: {
  paths: string[]
  children: Record<string, { name: string; path: string; isDir: boolean; weight: number }[]>
  folderWeights: Record<string, number>
}): TreeIndex {
  const tree = createEmptyTreeIndex()
  for (const p of data.paths) tree.paths.add(p)
  for (const [k, v] of Object.entries(data.folderWeights)) tree.folderWeights.set(k, v)

  // Build children map from server data
  for (const [prefix, entries] of Object.entries(data.children)) {
    tree.children.set(prefix, entries.map(e => ({ ...e })))
  }

  // Ensure root children exist
  if (!tree.children.has("")) {
    rebuildChildrenForPrefix(tree, "")
  }

  return tree
}

export function addPathToTree(tree: TreeIndex, path: string): void {
  if (tree.paths.has(path)) return
  tree.paths.add(path)
  rebuildChildrenForPrefix(tree, getParentPrefix(path))

  // Ensure ancestor directories have children entries
  const parts = path.split("/")
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join("/")
    if (!tree.children.has(prefix)) {
      rebuildChildrenForPrefix(tree, prefix)
    }
  }
}

export function removePathFromTree(tree: TreeIndex, path: string): void {
  if (!tree.paths.has(path)) return
  tree.paths.delete(path)
  rebuildChildrenForPrefix(tree, getParentPrefix(path))
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

  // Check if lastPath is a directory
  const dirChildren = tree.children.get(lastPath)
  if (dirChildren && dirChildren.length > 0) {
    const dirs = dirChildren.filter(c => c.isDir).map(c => c.path)
    const files = dirChildren.filter(c => !c.isDir).map(c => c.path)
    return [...dirs.slice(0, max), ...files.slice(0, max - dirs.length)].slice(0, max)
  }

  // lastPath is a file — get the containing directory
  const fileParts = lastPath.split("/")
  const parentPrefix = fileParts.slice(0, -1).join("/")
  const result: string[] = []

  // 1. Children of the containing directory (dirs first, then files)
  const parentChildren = tree.children.get(parentPrefix) ?? []
  const filteredDirs = parentChildren.filter(c => c.isDir && c.path !== lastPath)
  const filteredFiles = parentChildren.filter(c => !c.isDir && c.path !== lastPath)
  result.push(
    ...filteredDirs.slice(0, max).map(c => c.path),
    ...filteredFiles.slice(0, max - filteredDirs.length).map(c => c.path),
  )

  if (result.length >= max) return result.slice(0, max)

  // 2. Parent directory's other children
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

  // Create a shallow clone of the tree with copied Sets/Maps
  const result: TreeIndex = {
    paths: new Set(tree.paths),
    children: new Map([...tree.children].map(([k, v]) => [k, [...v]])),
    folderWeights: new Map(tree.folderWeights),
  }

  for (const op of ops) {
    switch (op.type) {
      case PendingOpType.Create:
        addPathToTree(result, op.path)
        break
      case PendingOpType.Delete:
        // Keep the path in the tree — sidebar renders it with a "pending-delete" badge.
        break
      case PendingOpType.Rename:
        removePathFromTree(result, op.from)
        addPathToTree(result, op.to)
        break
      case PendingOpType.Move:
        removePathFromTree(result, op.from)
        addPathToTree(result, op.to)
        break
    }
  }
  return result
}
