import type { TreeNode } from "@/components/panels/sidebar"
import { PendingOpType, type PendingOp } from "@/entities/PendingOps"
import { nodeWeight } from "@/utils/hugo-compat"

export type { PendingOp }
export { PendingOpType }

export function collectLeaves(tree: TreeNode, prefix = ""): string[] {
  const leaves: string[] = [];
  for (const [key, val] of Object.entries(tree)) {
    const fullPath = prefix ? `${prefix}/${key}` : key;
    if (val === null || (typeof val === "object" && "weight" in val)) {
      leaves.push(fullPath.replace(/\.md$/, ""));
    } else if (typeof val === "object" && val !== null) {
      leaves.push(...collectLeaves(val as TreeNode, fullPath));
    }
  }
  return leaves;
}

export function setPath(tree: TreeNode, path: string): void {
  const parts = path.split("/")
  let node = tree
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === parts.length - 1) {
      // Keys may have .md extension while incoming paths do not
      if (!(part in node) && !(`${part}.md` in node)) {
        node[part] = null
      }
    } else {
      if (!(part in node) || node[part] === null) {
        node[part] = {}
      }
      node = node[part] as TreeNode
    }
  }
}

export function removePath(tree: TreeNode, path: string): void {
  const parts = path.split("/")
  let node = tree
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in node) || node[part] === null) return
    node = node[part] as TreeNode
  }
  const last = parts[parts.length - 1]
  // Keys may have .md extension while incoming paths do not
  if (last in node) {
    delete node[last]
  } else if (`${last}.md` in node) {
    delete node[`${last}.md`]
  }
}

/**
 * Return up to `max` sibling files from the same directory as `path`,
 * excluding `path` itself.  Returns display paths (no `.md` extension).
 */
export function getNeighbors(tree: TreeNode, path: string, max = 2): string[] {
  const parts = path.split("/")
  if (parts.length < 2) return []

  const dirParts = parts.slice(0, -1)
  let node: TreeNode | null | undefined = tree
  for (const part of dirParts) {
    if (!node || typeof node !== "object") return []
    node = node[part] as TreeNode | null | undefined
  }
  if (!node || typeof node !== "object") return []

  const leaves: string[] = []
  const prefix = dirParts.join("/")
  for (const [key, val] of Object.entries(node)) {
    if (val === null || (typeof val === "object" && "weight" in val)) {
      const display = prefix ? `${prefix}/${key.replace(/\.md$/, "")}` : key.replace(/\.md$/, "")
      if (display !== path) leaves.push(display)
    }
  }
  return leaves.slice(0, max)
}

/** Collect immediate children (dirs and files) of a tree node, sorted by weight. */
function collectChildren(node: TreeNode, prefix: string): { dirs: string[]; files: string[] } {
  const entries = Object.entries(node)
  const dirs = entries
    .filter(([_, val]) => typeof val === "object" && val !== null && !("weight" in val))
    .sort(([a, va], [b, vb]) => nodeWeight(va) - nodeWeight(vb))
    .map(([key]) => prefix ? `${prefix}/${key}` : key)
  const files = entries
    .filter(([_, val]) => val === null || (typeof val === "object" && "weight" in val))
    .sort(([a, va], [b, vb]) => nodeWeight(va) - nodeWeight(vb))
    .map(([key]) => (prefix ? `${prefix}/${key}` : key).replace(/\.md$/, ""))
  return { dirs, files }
}

/** Walk the tree to find the node at `parts`. */
function walkTree(tree: TreeNode, parts: string[]): TreeNode | undefined {
  let node: any = tree
  for (const part of parts) {
    if (!node || typeof node !== "object") return undefined
    node = node[part]
  }
  return node && typeof node === "object" ? node : undefined
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
export function getSuggestions(tree: TreeNode, lastPath: string, max = 3): string[] {
  if (Object.keys(tree).length === 0) return []

  if (!lastPath) {
    const { dirs, files } = collectChildren(tree, "")
    return [...dirs.slice(0, max), ...files.slice(0, max - dirs.length)].slice(0, max)
  }

  const parts = lastPath.split("/")

  // Check if lastPath is a directory key in the tree
  const dirNode = walkTree(tree, parts)
  if (dirNode && typeof dirNode === "object" && !("weight" in dirNode)) {
    const { dirs, files } = collectChildren(dirNode, lastPath)
    return [...dirs.slice(0, max), ...files.slice(0, max - dirs.length)].slice(0, max)
  }

  // lastPath is a file — get the containing directory
  const fileParts = parts.slice(0, -1)
  const containingDirNode = fileParts.length > 0 ? walkTree(tree, fileParts) : undefined
  const result: string[] = []

  // 1. Children of the containing directory (dirs first, then files)
  if (containingDirNode && typeof containingDirNode === "object") {
    const { dirs, files } = collectChildren(containingDirNode, fileParts.join("/"))
    // Exclude lastPath itself from suggestions
    const filteredDirs = dirs.filter(d => d !== lastPath)
    const filteredFiles = files.filter(f => f !== lastPath)
    result.push(...filteredDirs.slice(0, max), ...filteredFiles.slice(0, max - filteredDirs.length))
  }

  if (result.length >= max) return result.slice(0, max)

  // 2. Parent directory's other children
  if (fileParts.length > 0) {
    const grandParentParts = fileParts.slice(0, -1)
    const grandParentNode = grandParentParts.length > 0
      ? walkTree(tree, grandParentParts)
      : tree
    const grandParentPrefix = grandParentParts.join("/")

    if (grandParentNode && typeof grandParentNode === "object") {
      const currentDirName = fileParts[fileParts.length - 1]
      const siblings = Object.entries(grandParentNode)
        .filter(([key]) => key !== currentDirName)
        .sort(([_, va], [__, vb]) => nodeWeight(va) - nodeWeight(vb))
      for (const [key, val] of siblings) {
        if (result.length >= max) break
        const display = grandParentPrefix ? `${grandParentPrefix}/${key}` : key
        const path = display.replace(/\.md$/, "")
        if (!result.includes(path)) result.push(path)
      }
    }
  }

  return result.slice(0, max)
}

export function applyPendingOps(tree: TreeNode, ops: PendingOp[]): TreeNode {
  if (ops.length === 0) return tree
  const result: TreeNode = JSON.parse(JSON.stringify(tree))
  for (const op of ops) {
    switch (op.type) {
      case PendingOpType.Create:
        setPath(result, op.path)
        break
      case PendingOpType.Delete:
        // Keep the node in the tree — sidebar renders it with a "pending-delete" badge.
        break
      case PendingOpType.Rename:
        removePath(result, op.from)
        setPath(result, op.to)
        break
      case PendingOpType.Move:
        removePath(result, op.from)
        setPath(result, op.to)
        break
    }
  }
  return result
}
