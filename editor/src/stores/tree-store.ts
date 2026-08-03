/**
 * TreeStore — single source of truth for the project file tree.
 *
 * Providers propagate mutations here after successful I/O.
 * Sidebar and other consumers read from here instead of calling provider.getTree().
 *
 * The tree uses a flat structure (Set + Map) for safe, efficient updates.
 */

import type { TreeIndex } from "@/utils/tree"
import { createEmptyTreeIndex, addPathToTree, removePathFromTree, setPathWeight } from "@/utils/tree"
import { appEvents, AppEvent } from "@/stores/app-events"

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
    appEvents.emit(AppEvent.TreeChanged)
  }

  getTree(): TreeIndex {
    return this.tree
  }

  /** Propagate a file write — ensure the path exists in the tree and sync its weight. */
  afterWrite(path: string, content?: string): void {
    if (content) {
      const w = extractWeight(content)
      const current = this.tree.fileWeights.get(path)
      if (w !== current) {
        this.setWeight(path, w)
      }
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

  /** Set a file's explicit weight (re-sorts the tree); weight `undefined` restores default order. */
  setWeight(path: string, weight: number | undefined): void {
    setPathWeight(this.tree, path, weight)
    appEvents.emit(AppEvent.TreeChanged)
  }

  isEmpty(): boolean {
    return this.tree.paths.size === 0
  }
}

export const treeStore = new TreeStore()
