import type { TreeNode } from "../components/panels/sidebar"

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

export type PendingOp =
  | { type: "create"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "rename"; from: string; to: string }
  | { type: "move"; from: string; to: string }

export function setPath(tree: TreeNode, path: string): void {
  const parts = path.split("/")
  let node = tree
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === parts.length - 1) {
      if (!(part in node)) {
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

function removePath(tree: TreeNode, path: string): void {
  const parts = path.split("/")
  let node = tree
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in node) || node[part] === null) return
    node = node[part] as TreeNode
  }
  const last = parts[parts.length - 1]
  delete node[last]
}

export function applyPendingOps(tree: TreeNode, ops: PendingOp[]): TreeNode {
  if (ops.length === 0) return tree
  const result: TreeNode = JSON.parse(JSON.stringify(tree))
  for (const op of ops) {
    switch (op.type) {
      case "create":
        setPath(result, op.path)
        break
      case "delete":
        removePath(result, op.path)
        break
      case "rename":
        removePath(result, op.from)
        setPath(result, op.to)
        break
      case "move":
        removePath(result, op.from)
        setPath(result, op.to)
        break
    }
  }
  return result
}
