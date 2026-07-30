/**
 * TreeStore — single source of truth for the project file tree.
 *
 * Providers propagate mutations here after successful I/O.
 * Sidebar and other consumers read from here instead of calling provider.getTree().
 *
 * The tree uses a flat structure (Set + Map) for safe, efficient updates.
 */

import type { TreeIndex } from "@/utils/tree"
import { createEmptyTreeIndex, addPathToTree, removePathFromTree } from "@/utils/tree"

function extractWeight(content: string): number | undefined {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return undefined
  const wm = fm[1].match(/^weight:\s*(\d+)/m)
  return wm ? parseInt(wm[1], 10) : undefined
}

class TreeStore {
  private tree: TreeIndex = createEmptyTreeIndex()

  setTree(tree: TreeIndex): void {
    this.tree = tree
  }

  getTree(): TreeIndex {
    return this.tree
  }

  /** Propagate a file write — ensure the path exists in the tree and update its weight. */
  afterWrite(path: string, content?: string): void {
    if (content && !this.tree.fileWeights.has(path)) {
      const w = extractWeight(content)
      if (w !== undefined) this.tree.fileWeights.set(path, w)
    }
    addPathToTree(this.tree, path)
  }

  afterDelete(path: string): void {
    removePathFromTree(this.tree, path)
  }

  /** Propagate a file move — remove source, ensure destination. */
  afterMove(from: string, to: string, content?: string): void {
    const weight = this.tree.fileWeights.get(from)
      ?? (content ? extractWeight(content) : undefined)
    if (weight !== undefined) {
      this.tree.fileWeights.set(to, weight)
    }
    removePathFromTree(this.tree, from)
    addPathToTree(this.tree, to)
  }

  isEmpty(): boolean {
    return this.tree.paths.size === 0
  }
}

export const treeStore = new TreeStore()
