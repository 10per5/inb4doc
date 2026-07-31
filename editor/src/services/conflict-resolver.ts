import type { Page } from "@/entities/Page"
import type { MetaPanelData } from "@/entities/Frontmatter"
import { serializeFrontmatter } from "@/utils/frontmatter"
import { pagesStore } from "@/stores/page-store"
import { openExternalChangeDialog } from "@/controllers/dialog/external-change-dialog"
import { Frontmatter } from "@/entities/Frontmatter"
import type { PendingOps } from "@/entities/PendingOps"

export type ConflictDecision =
  | { action: "accept-disk"; body: string; fm: MetaPanelData | null; time: number }
  | {
      action: "show-dialog"
      localBody: string
      localFm: MetaPanelData | undefined
      diskRaw: string
      diskBody: string
      diskFm: MetaPanelData | null
      diskTime: number
    }

export function resolveConflict(
  page: Page | undefined,
  diskBody: string,
  diskFm: MetaPanelData | null,
  serverTime: number | null,
  pendingOps?: PendingOps,
): ConflictDecision | null {
  if (!page) return null

  const baseline = page.bodyState.baseline
  if (baseline === undefined) return null
  if (baseline === diskBody) return null

  const hasDirty = pendingOps?.hasPendingEdit(page.path) ?? false

  if (hasDirty) {
    const localBody = page.bodyState.body ?? diskBody
    const localFm = page.getFrontmatter()
    return {
      action: "show-dialog",
      localBody,
      localFm,
      diskRaw: "",
      diskBody,
      diskFm,
      diskTime: serverTime ?? Date.now(),
    }
  }

  return {
    action: "accept-disk",
    body: diskBody,
    fm: diskFm,
    time: serverTime ?? Date.now(),
  }
}

export interface ConflictHost {
  currentPath: string
  ensureEditor(content: string): Promise<void>
  onMetaUpdate?: (data: MetaPanelData) => void
}

export function executeConflictDecision(
  decision: ConflictDecision,
  path: string,
  diskRaw: string,
  serverTime: number | null,
  host: ConflictHost,
  pendingOps?: PendingOps,
): void {
  if (decision.action === "accept-disk") {
    pagesStore.clearPath(path)
    pendingOps?.cancelEdit(path)
    const fresh = pagesStore.getOrCreate(path)
    fresh.setBaseline(decision.body)
    fresh.setServerTime(decision.time)
    fresh.originalFrontmatter = decision.fm ? Frontmatter.fromMeta(decision.fm) : undefined
    if (decision.fm) { fresh.setFrontmatter(decision.fm); host.onMetaUpdate?.(decision.fm) }
    return
  }

  const localFull = decision.localFm
    ? `---\n${serializeFrontmatter(decision.localFm)}\n---\n\n${decision.localBody}`
    : decision.localBody

  openExternalChangeDialog(path, localFull, diskRaw).then((action) => {
    if (host.currentPath !== path) return
    pagesStore.clearPath(path)
    pendingOps?.cancelEdit(path)
    const p = pagesStore.getOrCreate(path)
    p.setBaseline(decision.diskBody)
    p.setServerTime(decision.diskTime)
    p.originalFrontmatter = decision.diskFm ? Frontmatter.fromMeta(decision.diskFm) : undefined

    if (action === "discard") {
      if (decision.diskFm) {
        p.setFrontmatter(decision.diskFm)
        host.onMetaUpdate?.(decision.diskFm)
      }
      host.ensureEditor(decision.diskBody)
    } else {
      if (decision.localFm) {
        p.setFrontmatter(decision.localFm)
        host.onMetaUpdate?.(decision.localFm)
      }
      p.setBody(decision.localBody)
      host.ensureEditor(decision.localBody)
    }
  })

  pagesStore.get(path)?.setServerTime(serverTime ?? Date.now())
}

export function applyNoConflict(
  path: string,
  body: string,
  frontmatter: MetaPanelData | null,
  serverTime: number | null,
  onMetaUpdate?: (data: MetaPanelData) => void,
  pendingOps?: PendingOps,
): string {
  const page = pagesStore.get(path)
  const cachedTime = page?.getServerTime() || 0

  if (serverTime && serverTime > cachedTime) {
    pagesStore.getOrCreate(path).setBaseline(body)
    pagesStore.getOrCreate(path).setServerTime(serverTime)
    pendingOps?.cancelEdit(path)
  } else if (pagesStore.getOrCreate(path).bodyState.baseline === undefined) {
    pagesStore.getOrCreate(path).setBaseline(body)
  }

  const editOp = pendingOps?.findEdit(path)
  if (editOp && editOp.patch) {
    const page = pagesStore.getOrCreate(path)
    page.bodyState.body = editOp.patch
  }

  const diskFm = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined

  if (frontmatter) {
    const isDirty = pendingOps?.hasPendingEdit(path) ?? false
    if (isDirty && page?.getFrontmatter()) {
      onMetaUpdate?.(page.getFrontmatter()!)
    } else {
      pagesStore.getOrCreate(path).setFrontmatter(frontmatter)
      onMetaUpdate?.(frontmatter)
    }
  } else {
    pagesStore.getOrCreate(path).removeFrontmatter()
    onMetaUpdate?.({ title: "" })
  }

  pagesStore.getOrCreate(path).originalFrontmatter = diskFm

  return pagesStore.get(path)?.bodyState.body ?? body
}
