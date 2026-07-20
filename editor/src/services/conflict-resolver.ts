/**
 * ConflictResolver — handles external-change detection and resolution.
 *
 * Extracted from EditorController.fetchContent. Owns the entire flow:
 * detect conflict → execute decision → show dialog if needed.
 * Uses event bus for dialog callbacks so it has no UI dependencies.
 */

import type { Page } from "@/entities/Page"
import type { MetaPanelData } from "@/components/panels/meta-panel"
import { serializeFrontmatter } from "@/utils/frontmatter"
import { pageRepository } from "@/repositories/pageRepository"
import { openExternalChangeDialog } from "@/components/dialogs/external-change-dialog"
import { Frontmatter } from "@/entities/Frontmatter"

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

/**
 * Determine whether a conflict exists between the cached page and the disk version.
 */
export function resolveConflict(
  page: Page | undefined,
  diskBody: string,
  diskFm: MetaPanelData | null,
  serverTime: number | null,
): ConflictDecision | null {
  if (!page) return null

  const baseline = page.bodyState.baseline
  if (baseline === undefined) return null
  if (baseline === diskBody) return null

  if (page.meta.dirty) {
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

/** Callback interface for the host to apply conflict results. */
export interface ConflictHost {
  currentPath: string
  ensureEditor(content: string): Promise<void>
  onMetaUpdate?: (data: MetaPanelData) => void
}

/**
 * Execute a conflict decision.
 * For "accept-disk", applies immediately.
 * For "show-dialog", mounts the dialog and applies when the user decides.
 */
export function executeConflictDecision(
  decision: ConflictDecision,
  path: string,
  diskRaw: string,
  serverTime: number | null,
  host: ConflictHost,
): void {
  if (decision.action === "accept-disk") {
    pageRepository.clearPath(path)
    const fresh = pageRepository.getOrCreate(path)
    fresh.setBaseline(decision.body)
    fresh.setServerTime(decision.time)
    fresh.originalFrontmatter = decision.fm ? Frontmatter.fromMeta(decision.fm) : undefined
    if (decision.fm) { fresh.setFrontmatter(decision.fm); host.onMetaUpdate?.(decision.fm) }
    return
  }

  // show-dialog
  const localFull = decision.localFm
    ? `---\n${serializeFrontmatter(decision.localFm)}\n---\n\n${decision.localBody}`
    : decision.localBody

  openExternalChangeDialog(path, localFull, diskRaw).then((action) => {
    if (host.currentPath !== path) return
    pageRepository.clearPath(path)
    const p = pageRepository.getOrCreate(path)
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

  pageRepository.get(path)?.setServerTime(serverTime ?? Date.now())
}

/**
 * Handle the no-conflict path: update baselines and frontmatter.
 */
export function applyNoConflict(
  path: string,
  body: string,
  frontmatter: MetaPanelData | null,
  serverTime: number | null,
  onMetaUpdate?: (data: MetaPanelData) => void,
): string {
  const page = pageRepository.get(path)
  const cachedTime = page?.getServerTime() || 0

  // Refresh the baseline from the current committed content. We deliberately do
  // not clearPath here: setBaseline re-applies any in-progress patch, so an
  // unflushed edit survives a reload instead of being silently discarded. This
  // makes all providers behave consistently (localStorage now returns a real
  // timestamp too) and fixes the asymmetry where only browser-storage pages
  // appeared "Discard (+0 B)" after a reload.
  if (serverTime && serverTime > cachedTime) {
    pageRepository.getOrCreate(path).setBaseline(body)
    pageRepository.getOrCreate(path).setServerTime(serverTime)
  } else if (pageRepository.getOrCreate(path).bodyState.baseline === undefined) {
    pageRepository.getOrCreate(path).setBaseline(body)
  }

  const diskFm = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined

  if (frontmatter) {
    if (page?.meta.dirty && page.getFrontmatter()) {
      onMetaUpdate?.(page.getFrontmatter()!)
    } else {
      pageRepository.getOrCreate(path).setFrontmatter(frontmatter)
      onMetaUpdate?.(frontmatter)
    }
  } else {
    pageRepository.getOrCreate(path).removeFrontmatter()
    onMetaUpdate?.({ title: "" })
  }

  pageRepository.getOrCreate(path).originalFrontmatter = diskFm

  return pageRepository.get(path)?.bodyState.body ?? body
}
