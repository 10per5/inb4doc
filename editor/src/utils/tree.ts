import type { TreeNode } from "@/components/panels/sidebar"
import { PendingOpType, type PendingOp } from "@/entities/PendingOps"

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
