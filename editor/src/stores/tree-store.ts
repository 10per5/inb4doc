/**
 * TreeStore — single source of truth for the project file tree.
 *
 * Providers propagate mutations here after successful I/O.
 * Sidebar and other consumers read from here instead of calling provider.getTree().
 *
 * The tree is mutated in-place for efficiency. Consumers that need
 * immutability should clone before reading.
 */

import type { TreeNode } from "@/providers/provider"
import { setPath, removePath } from "@/utils/tree"

class TreeStore {
  private tree: TreeNode = {}

  /** Replace the entire tree (initial load, provider switch). */
  setTree(tree: TreeNode): void {
    this.tree = tree
  }

  /** Read the current tree. */
  getTree(): TreeNode {
    return this.tree
  }

  /** Propagate a file write — ensure the path exists in the tree. */
  afterWrite(path: string): void {
    setPath(this.tree, path)
  }

  /** Propagate a file delete — remove the path from the tree. */
  afterDelete(path: string): void {
    removePath(this.tree, path)
  }

  /** Propagate a file move — remove source, ensure destination. */
  afterMove(from: string, to: string): void {
    removePath(this.tree, from)
    setPath(this.tree, to)
  }

  /** Whether the tree has any entries. */
  isEmpty(): boolean {
    return Object.keys(this.tree).length === 0
  }
}

export const treeStore = new TreeStore()
