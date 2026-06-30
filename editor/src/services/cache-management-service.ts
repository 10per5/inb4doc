/**
 * CacheManagementService
 *
 * Manages file caching, dirty tracking, and file synchronization
 * Handles flushing changes and discarding edits
 * Owns pending sidebar operations (create/delete/rename/move)
 */

import { stripFrontmatter, serializeFrontmatter } from "../utils/frontmatter";
import {
  mountChangesDialog,
  type ChangesDialogData,
} from "../components/dialogs/changes-dialog";
import { confirmDialog } from "../components/dialogs/dialog";
import { cache } from "../cache";
import { getProvider } from "../content/provider-registry";
import {
  commitAllPendingImages,
  replacePendingUrls,
  getCurrentDocDir,
} from "./image-config";
import { imageRegistry } from "./image-registry";
import { applyPendingOps, type PendingOp } from "../utils/tree";
import type { TreeNode } from "../components/panels/sidebar";
import {
  savePendingOps,
  loadPendingOps,
  clearPendingOpsStorage,
} from "../storage";
import { extractSnippets } from "../utils/content-search";

export interface SearchMatch {
  path: string;
  snippets: string[];
}

export interface CacheCallbacks {
  getCurrentContent?: () => string;
  onFlushComplete?: () => void;
  onDiscardComplete?: () => void;
  onDirtyCountChanged?: (
    count: number,
    bytes: number,
    pendingCount: number,
  ) => void;
  onSingleCurrentDirty?: (path: string, bytes: number) => void;
  onSidebarReload?: () => void;
  onNavigate?: (path: string) => void;
  onContentReload?: (path: string, content: string) => Promise<void>;
}

export class CacheManagementService {
  private callbacks: CacheCallbacks;
  private currentPath: string = "";
  private pendingOps: PendingOp[] = [];

  constructor(callbacks: CacheCallbacks = {}) {
    this.callbacks = callbacks;
    const saved = loadPendingOps<PendingOp[]>();
    if (Array.isArray(saved) && saved.length > 0) {
      this.pendingOps = saved;
    }
  }

  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  private persistPendingOps(): void {
    savePendingOps(this.pendingOps);
  }

  // ── Pending Operations ──

  queueCreate(path: string, content: string): void {
    const delIdx = this.pendingOps.findIndex(
      (o) => o.type === "delete" && o.path === path,
    );
    if (delIdx !== -1) {
      this.pendingOps.splice(delIdx, 1);
    } else {
      this.pendingOps.push({ type: "create", path, content });
    }
    this.persistPendingOps();
  }

  queueDelete(path: string): void {
    const createIdx = this.pendingOps.findIndex(
      (o) => o.type === "create" && o.path === path,
    );
    if (createIdx !== -1) {
      this.pendingOps.splice(createIdx, 1);
    } else {
      this.pendingOps.push({ type: "delete", path });
    }
    this.persistPendingOps();
  }

  queueRename(from: string, to: string): void {
    this.pendingOps.push({ type: "rename", from, to });
    this.persistPendingOps();
  }

  queueMove(from: string, to: string): void {
    this.pendingOps.push({ type: "move", from, to });
    this.persistPendingOps();
  }

  getPendingOps(): PendingOp[] {
    return this.pendingOps;
  }

  getPendingOpsCount(): number {
    return this.pendingOps.length;
  }

  clearPendingOps(): void {
    this.pendingOps = [];
    clearPendingOpsStorage();
  }

  applyPendingOpsToTree(tree: TreeNode): TreeNode {
    return applyPendingOps(tree, this.pendingOps);
  }

  // ── Dirty-state counters ──

  updateDirtyCounter(): void {
    let totalBytes = 0;
    const dirtyPaths = cache.getDirtyPaths();
    for (const path of dirtyPaths) {
      totalBytes += cache.getBodyDelta(path);
    }
    const count = dirtyPaths.length;
    this.callbacks.onSidebarReload?.();
    if (
      count === 1 &&
      dirtyPaths[0] === this.currentPath &&
      this.pendingOps.length === 0
    ) {
      this.callbacks.onSingleCurrentDirty?.(dirtyPaths[0], totalBytes);
    } else {
      this.callbacks.onDirtyCountChanged?.(
        count,
        totalBytes,
        this.pendingOps.length,
      );
    }
  }

  getDirtyState(): { count: number; bytes: number; pendingCount: number } {
    let totalBytes = 0;
    for (const path of cache.getDirtyPaths()) {
      totalBytes += cache.getBodyDelta(path);
    }
    return {
      count: cache.getDirtyCount(),
      bytes: totalBytes,
      pendingCount: this.pendingOps.length,
    };
  }

  // ── Execute pending ops against the provider ──

  private async executePendingOps(): Promise<void> {
    if (this.pendingOps.length === 0) return;
    const provider = getProvider();

    for (const op of this.pendingOps) {
      try {
        switch (op.type) {
          case "create":
            await provider?.writeFile(op.path, op.content);
            break;
          case "delete":
            await provider?.deleteFile?.(op.path);
            break;
          case "rename":
            await provider?.moveFile?.(op.from, op.to);
            break;
          case "move":
            await provider?.moveFile?.(op.from, op.to);
            break;
        }
      } catch (error) {
        console.error(
          `Failed to execute pending op ${op.type} ${"path" in op ? op.path : op.from}:`,
          error,
        );
      }
    }

    this.pendingOps = [];
    clearPendingOpsStorage();
  }

  // ── Flush ──

  async flushDirtyFiles(): Promise<void> {
    const dirtyPaths = cache.getDirtyPaths();
    if (dirtyPaths.length === 0 && this.pendingOps.length === 0) return;

    const currentMd = this.callbacks.getCurrentContent?.() || "";
    const provider = getProvider();

    // 1. Commit all pending images first
    const imageUrlMap = await commitAllPendingImages();

    // 2. Execute pending ops (create/delete/rename/move)
    await this.executePendingOps();

    // 3. Write dirty files
    for (const path of dirtyPaths) {
      let body: string;

      if (path === this.currentPath) {
        body = currentMd;
      } else {
        const cached = cache.getBody(path);
        if (cached) {
          body = cached;
        } else {
          const cachedRaw = await provider?.readFile(path);
          if (!cachedRaw) continue;
          body = stripFrontmatter(cachedRaw).body;
        }
      }

      if (imageUrlMap.size > 0) {
        body = replacePendingUrls(body, imageUrlMap);
      }

      const fmData = cache.getFrontmatter(path);
      const fullContent = fmData
        ? `---\n${serializeFrontmatter(fmData)}\n---\n\n${body}`
        : body;

      if (path === this.currentPath) {
        const serverTime = cache.getServerTime(path);
        if (serverTime) {
          const fileTime = await provider?.getServerTime(path);
          if (fileTime && fileTime > serverTime) {
            if (!confirm(`"${path}" was modified on disk. Overwrite?`))
              continue;
          }
        }
      }

      try {
        await provider?.writeFile(path, fullContent);
        cache.deletePatch(path);
        cache.setBaseline(path, body);
        cache.cacheBody(path, body);
        const fileTime = await provider?.getServerTime(path);
        if (fileTime) cache.setServerTime(path, fileTime);
      } catch (error) {
        console.error(`Failed to flush ${path}:`, error);
      }
    }

    cache.sync();
    this.updateDirtyCounter();
    this.callbacks.onFlushComplete?.();

    // 4. Clean up orphaned images — images that no longer appear in any document
    this.cleanupOrphanedImages(dirtyPaths, provider).catch(() => {});
  }

  private async cleanupOrphanedImages(
    dirtyPaths: string[],
    provider: any,
  ): Promise<void> {
    const dirs = new Set(
      dirtyPaths.map((p) =>
        p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : "",
      ),
    );
    for (const dir of dirs) {
      if (!provider.listImages || !provider.deleteImage) continue;
      try {
        const images = await provider.listImages(dir, true);
        for (const img of images) {
          if (img.usedIn.length === 0) {
            await provider.deleteImage(img.name, dir);
          }
        }
      } catch {}
    }
  }

  // ── Discard ──

  async discardFileChanges(pagePath: string): Promise<void> {
    cache.clearPath(pagePath);
    cache.sync();
    this.updateDirtyCounter();

    if (pagePath === this.currentPath) {
      const provider = getProvider();
      const raw = (await provider?.readFile(pagePath)) || "";
      const { frontmatter, body } = stripFrontmatter(raw);
      if (frontmatter) cache.setFrontmatter(pagePath, frontmatter);
      cache.setBaseline(pagePath, body);

      await this.callbacks.onContentReload?.(pagePath, body);
    }

    this.callbacks.onDiscardComplete?.();
  }

  // ── Changes dialog ──

  async handleDirtyClick(): Promise<void> {
    const dirtyPaths = cache.getDirtyPaths();
    if (dirtyPaths.length === 0 && this.pendingOps.length === 0) return;

    const provider = getProvider();
    const changes: ChangesDialogData[] = [];

    // Pending ops section
    for (const op of this.pendingOps) {
      let label = "";
      switch (op.type) {
        case "create":
          label = `Create: ${op.path}`;
          break;
        case "delete":
          label = `Delete: ${op.path}`;
          break;
        case "rename":
          label = `Rename: ${op.from} → ${op.to}`;
          break;
        case "move":
          label = `Move: ${op.from} → ${op.to}`;
          break;
      }
      changes.push({ isPendingOp: true, opLabel: label });
    }

    // Dirty files section
    for (const path of dirtyPaths) {
      let md = cache.reconstructContent(path);

      if (!md && path === this.currentPath) {
        md = this.callbacks.getCurrentContent?.();
      }

      if (!md) {
        const cachedRaw = await provider?.readFile(path);
        if (!cachedRaw) continue;
        const { body } = stripFrontmatter(cachedRaw);
        cache.setBaseline(path, body);
        md = cache.reconstructContent(path);
      }

      if (!md) continue;

      changes.push({
        path,
        currentPath: path === this.currentPath,
        md,
        changeSize: cache.getBodyDelta(path),
      });
    }

    await mountChangesDialog(
      changes,
      this.currentPath,
      {
        onDiscard: (path) => {
          cache.clearPath(path);
          cache.sync();
          this.updateDirtyCounter();

          if (path === this.currentPath) {
            provider?.readFile(path).then((raw) => {
              const { frontmatter, body } = stripFrontmatter(raw || "");
              if (frontmatter) cache.setFrontmatter(path, frontmatter);
              cache.setBaseline(path, body);
              this.callbacks.onContentReload?.(path, body);
            });
          }
        },
        onNavigate: (path) => this.callbacks.onNavigate?.(path),
        onReload: async (path) => (await provider?.readFile(path)) || "",
        onFlushAll: () => this.flushDirtyFiles(),
        onDiscardAll: async () => {
          const paths = cache.getDirtyPaths();
          for (const p of paths) {
            cache.clearPath(p);
          }
          this.clearPendingOps();
          await imageRegistry.removeAllForDir(getCurrentDocDir());
          cache.sync();
          this.updateDirtyCounter();
          this.callbacks.onSidebarReload?.();

          if (paths.includes(this.currentPath)) {
            const raw = (await provider?.readFile(this.currentPath)) || "";
            const { frontmatter, body } = stripFrontmatter(raw);
            if (frontmatter)
              cache.setFrontmatter(this.currentPath, frontmatter);
            cache.setBaseline(this.currentPath, body);
            await this.callbacks.onContentReload?.(this.currentPath, body);
          }
        },
      },
      () => {},
    );
  }
}

export function searchCache(allPaths: string[], query: string): SearchMatch[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: SearchMatch[] = [];
  for (const path of allPaths) {
    const body = cache.getBody(path) ?? cache.getBaseline(path);
    if (body && body.toLowerCase().includes(q)) {
      results.push({ path, snippets: extractSnippets(body, q) });
    }
  }
  return results;
}
