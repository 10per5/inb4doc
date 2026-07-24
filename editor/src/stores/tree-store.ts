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

class TreeStore {
  private tree: TreeIndex = createEmptyTreeIndex()

  /** Replace the entire tree (initial load, provider switch). */
  setTree(tree: TreeIndex): void {
    this.tree = tree
  }

  /** Read the current tree. */
  getTree(): TreeIndex {
    return this.tree
  }

  /** Propagate a file write — ensure the path exists in the tree. */
  afterWrite(path: string): void {
    addPathToTree(this.tree, path)
  }

  /** Propagate a file delete — remove the path from the tree. */
  afterDelete(path: string): void {
    removePathFromTree(this.tree, path)
  }

  /** Propagate a file move — remove source, ensure destination. */
  afterMove(from: string, to: string): void {
    removePathFromTree(this.tree, from)
    addPathToTree(this.tree, to)
  }

  /** Whether the tree has any entries. */
  isEmpty(): boolean {
    return this.tree.paths.size === 0
  }
}

export const treeStore = new TreeStore()
