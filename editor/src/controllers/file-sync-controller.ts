/**
 * FileSyncController
 *
 * Application-level orchestration for file synchronization.
 * Coordinates PendingOps, Page.flushOut/flushIn, ImageRegistry,
 * provider IO, dirty counters, and UI callbacks.
 */

import { stripFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import { Frontmatter } from "@/entities/Frontmatter";
import {
  openChangesDialog,
  type ChangesDialogData,
} from "@/components/dialogs/changes-dialog";
import { pageRepository } from "@/repositories/pageRepository";
import { PendingOps, PendingOpType, type PendingOp } from "@/entities/PendingOps";
import { pendingOpsRepository } from "@/repositories/pendingOpsRepository";
import { getProvider } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { showNotification } from "@/components/notification/notification";
import type { TreeNode } from "@/components/panels/sidebar";
import { extractSnippets } from "@/utils/content-search";
import { imageRepository } from "@/repositories/imageRepository";
import { pageRepository as repo } from "@/repositories/pageRepository";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { flushSave } from "@/stores/persistence";
import type { EditorController } from "@/controllers/editor-controller";

export interface SearchMatch {
  path: string;
  snippets: string[];
}

export class FileSyncController {
  private editor: EditorController;
  private currentPath: string = "";
  private pendingOps: PendingOps;
  private unsubs: (() => void)[] = [];

  constructor(editor: EditorController) {
    this.editor = editor;
    this.pendingOps = new PendingOps(pendingOpsRepository.load());

    // Subscribe to events
    this.unsubs.push(
      appEvents.on(AppEvent.ProviderChanged, () => {
        this.pendingOps = new PendingOps(pendingOpsRepository.load());
      }),
    );
  }

  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  getPendingOps(): PendingOps {
    return this.pendingOps;
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
  }

  // ── Pending Operations ──

  queueCreate(path: string, content: string): void {
    this.pendingOps.queueCreate(path, content);
    pendingOpsRepository.save(this.pendingOps.all);
  }

  queueDelete(path: string): void {
    this.pendingOps.queueDelete(path);
    pendingOpsRepository.save(this.pendingOps.all);
  }

  queueRename(from: string, to: string): void {
    const content = repo.getOrCreate(from).reconstructContent() ?? undefined;
    this.pendingOps.queueRename(from, to, content);
    pendingOpsRepository.save(this.pendingOps.all);
    const fromDir = from.includes("/") ? from.substring(0, from.lastIndexOf("/")) : "";
    const toDir = to.includes("/") ? to.substring(0, to.lastIndexOf("/")) : "";
    if (fromDir !== toDir) {
      imageRepository.remapDir(fromDir, toDir).catch(() => {});
    }
  }

  queueMove(from: string, to: string): void {
    const content = repo.getOrCreate(from).reconstructContent() ?? undefined;
    this.pendingOps.queueMove(from, to, content);

    const fromPage = repo.getOrCreate(from);
    repo.clearPath(to);
    const toPage = repo.getOrCreate(to);
    if (fromPage.bodyState.body !== undefined) toPage.bodyState.cacheBody(fromPage.bodyState.body);
    if (fromPage.bodyState.baseline !== undefined) toPage.bodyState.setBaseline(fromPage.bodyState.baseline);
    if (fromPage.frontmatter) toPage.frontmatter = fromPage.frontmatter;
    repo.save();

    pendingOpsRepository.save(this.pendingOps.all);
    const fromDir = from.includes("/") ? from.substring(0, from.lastIndexOf("/")) : "";
    const toDir = to.includes("/") ? to.substring(0, to.lastIndexOf("/")) : "";
    if (fromDir !== toDir) {
      imageRepository.remapDir(fromDir, toDir).catch(() => {});
    }
  }

  getPendingOpsCount(): number {
    return this.pendingOps.count;
  }

  async afterRestore(): Promise<void> {
    const blobToRef = new Map<string, string>()
    for (const dir of imageRepository.getAllPendingDirs()) {
      for (const p of imageRepository.getPending(dir)) {
        if (p.blobUrl) blobToRef.set(p.blobUrl, `pending-image:${p.id}`)
      }
    }
    if (blobToRef.size === 0) return

    for (const path of repo.getDirtyPaths()) {
      const page = repo.getOrCreate(path)
      if (!page.bodyState.body) continue
      let modified = false
      let newBody = page.bodyState.body
      for (const [blobUrl, ref] of blobToRef) {
        if (newBody.includes(blobUrl)) {
          newBody = newBody.split(blobUrl).join(ref)
          modified = true
        }
      }
      if (modified) {
        page.setBody(newBody)
        repo.save()
      }
    }
  }

  private existsInTree(tree: TreeNode, path: string): boolean {
    const parts = path.split("/");
    let node: TreeNode | null | undefined = tree;
    for (let i = 0; i < parts.length; i++) {
      if (!node || typeof node !== "object") return false;
      const part = parts[i];
      node = (node[part] ?? node[part + ".md"]) as TreeNode | null | undefined;
    }
    return node !== undefined;
  }

  async pathExists(path: string): Promise<boolean> {
    if (this.pendingOps.hasPendingDelete(path)) return false;
    if (this.pendingOps.hasPendingCreate(path)) return true;
    if (this.pendingOps.hasPendingMoveTo(path)) return true;

    const existing = repo.get(path)
    if (
      existing?.bodyState.body !== undefined ||
      existing?.frontmatter !== undefined
    ) {
      return true;
    }

    try {
      const tree = treeStore.getTree();
      return this.existsInTree(tree, path);
    } catch {}

    return false;
  }

  clearPendingOps(): void {
    this.pendingOps.clear();
    pendingOpsRepository.clear();
  }

  createDraft(path: string, content: string): void {
    this.queueCreate(path, content);
    const page = repo.getOrCreate(path);
    page.bodyState.cacheBody(content);
    page.bodyState.setBaseline(content);
  }

  applyPendingOpsToTree(tree: TreeNode): TreeNode {
    return this.pendingOps.applyToTree(tree);
  }

  // ── Dirty-state recompute ──
  //
  // The authoritative dirty accounting lives in `DirtyTrackingService`, which
  // listens for body/frontmatter edits and emits `DirtyChanged`. After mutations
  // performed outside the event stream (flush, discard, provider switch) we ask
  // it to recompute from the persisted page cache.

  private recomputeDirty(): void {
    dirtyTrackingService.recompute();
  }

  // ── Flush ──

  async flushCurrentFile(path: string, content: string): Promise<void> {
    const imageUrlMap = await imageRepository.commitAllPendingImages();
    const page = repo.getOrCreate(path);
    page.setBody(content);

    const ok = await page.flushOut(imageUrlMap);
    if (ok) {
      treeStore.afterWrite(path);
      repo.save();
      this.recomputeDirty();
      showNotification("File saved", { type: "success" });
    } else {
      showNotification("Failed to save", { type: "danger" });
    }
  }

  async flushDirtyFiles(): Promise<void> {
    const dirtyPaths = repo.getDirtyPaths();
    if (dirtyPaths.length === 0 && this.pendingOps.count === 0) return;

    const currentMd = this.editor.getCurrentContent();
    const provider = getProvider();

    const imageUrlMap = await imageRepository.commitAllPendingImages();

    for (const path of dirtyPaths) {
      const page = repo.getOrCreate(path);

      if (path === this.currentPath) {
        page.setBody(currentMd);
      } else if (page.bodyState.body == null) {
        const cachedRaw = await provider?.readFile(path);
        if (!cachedRaw) continue;
        page.setBody(stripFrontmatter(cachedRaw).body);
      }

      if (path === this.currentPath) {
        const serverTime = page.getServerTime();
        if (serverTime) {
          const fileTime = await provider?.getServerTime(path);
          if (fileTime && fileTime > serverTime) {
            if (!confirm(`"${path}" was modified on disk. Overwrite?`))
              continue;
          }
        }
      }

      await page.flushOut(imageUrlMap);
    }

    repo.save();

    await this.executePendingOps();

    this.recomputeDirty();

    appEvents.emit(AppEvent.FlushComplete);

    showNotification("All files saved", { type: "success" });

    this.cleanupOrphanedImages(dirtyPaths, provider).catch(() => {});
  }

  private async executePendingOps(): Promise<void> {
    if (this.pendingOps.count === 0) return;
    const provider = getProvider();

    for (const op of this.pendingOps.all) {
      try {
        switch (op.type) {
          case PendingOpType.Create:
            await provider?.writeFile(op.path, op.content);
            treeStore.afterWrite(op.path);
            break;
          case PendingOpType.Delete:
            await provider?.deleteFile?.(op.path);
            treeStore.afterDelete(op.path);
            break;
          case PendingOpType.Rename:
            if (op.content) {
              await provider?.writeFile?.(op.to, op.content);
              await provider?.deleteFile?.(op.from);
              treeStore.afterMove(op.from, op.to);
            } else {
              await provider?.moveFile?.(op.from, op.to);
              treeStore.afterMove(op.from, op.to);
            }
            break;
          case PendingOpType.Move:
            if (op.content) {
              await provider?.writeFile?.(op.to, op.content);
              await provider?.deleteFile?.(op.from);
              treeStore.afterMove(op.from, op.to);
            } else {
              await provider?.moveFile?.(op.from, op.to);
              treeStore.afterMove(op.from, op.to);
            }
            break;
        }
      } catch (error) {
        console.error(
          `Failed to execute pending op ${op.type} ${"path" in op ? op.path : op.from}:`,
          error,
        );
      }
    }

    this.pendingOps.clear();
    pendingOpsRepository.clear();
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
    repo.clearPath(pagePath);
    repo.save();
    this.recomputeDirty();
    this.editor.invalidateState(pagePath);

    if (pagePath === this.currentPath) {
      const provider = getProvider();
      const raw = (await provider?.readFile(pagePath)) || "";
      const { frontmatter, body } = stripFrontmatter(raw);
      const page = repo.getOrCreate(pagePath);
      if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter);
      page.originalFrontmatter = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined;
      page.setBaseline(body);

      await this.editor.ensureEditor(body);
    }

    showNotification("Changes discarded", { type: "info" });
  }

  // ── Changes dialog ──

  async handleDirtyClick(): Promise<void> {
    const dirtyPaths = repo.getDirtyPaths();
    if (dirtyPaths.length === 0 && this.pendingOps.count === 0) return;

    const provider = getProvider();
    const pendingChanges: { opLabel: string }[] = [];

    for (const op of this.pendingOps.all) {
      let label = "";
      switch (op.type) {
        case PendingOpType.Create:
          label = `Create: ${op.path}`;
          break;
        case PendingOpType.Delete:
          label = `Delete: ${op.path}`;
          break;
        case PendingOpType.Rename:
          label = `Rename: ${op.from} → ${op.to}`;
          break;
        case PendingOpType.Move:
          label = `Move: ${op.from} → ${op.to}`;
          break;
      }
      pendingChanges.push({ opLabel: label });
    }

    const dirtyChanges: ChangesDialogData[] = [];

    for (const path of dirtyPaths) {
      let md = repo.getOrCreate(path).reconstructContent();

      if (!md && path === this.currentPath) {
        md = this.editor.getCurrentContent();
      }

      if (!md) {
        const cachedRaw = await provider?.readFile(path);
        if (!cachedRaw) continue;
        const { frontmatter: rawFm, body } = stripFrontmatter(cachedRaw);
        const fallbackPage = repo.getOrCreate(path);
        fallbackPage.setBaseline(body);
        fallbackPage.originalFrontmatter = rawFm ? Frontmatter.fromMeta(rawFm) : undefined;
        md = fallbackPage.reconstructContent();
      }

      if (!md) continue;

      dirtyChanges.push({
        path,
        currentPath: path === this.currentPath,
        md,
        changeSize: repo.getOrCreate(path).bodyState.getDelta(),
      });
    }

    await openChangesDialog(
      dirtyChanges,
      pendingChanges,
      this.currentPath,
      {
        onDiscard: (path) => {
          repo.clearPath(path);
          repo.save();
          this.recomputeDirty();
          this.editor.invalidateState(path);

          if (path === this.currentPath) {
            provider?.readFile(path).then((raw) => {
              const { frontmatter, body } = stripFrontmatter(raw || "");
              const page = repo.getOrCreate(path);
              if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter);
              page.originalFrontmatter = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined;
              page.setBaseline(body);
              this.editor.ensureEditor(body);
            });
          }
        },
        onLoadOriginal: async (path) => {
          const page = repo.getOrCreate(path);
          if (page.bodyState.baseline !== undefined) {
            if (page.originalFrontmatter) {
              return "---\n" + page.originalFrontmatter.serialize() + "\n---\n\n" + page.bodyState.baseline;
            }
            return page.bodyState.baseline;
          }
          return (await provider?.readFile(path)) || "";
        },
        onFlushAll: () => this.flushDirtyFiles(),
        onDiscardAll: async () => {
          const paths = repo.getDirtyPaths();
          for (const p of paths) {
            repo.clearPath(p);
            this.editor.invalidateState(p);
          }
          this.clearPendingOps();
          await imageRepository.removeAllForDir(imageRepository.getCurrentDocDir());
          repo.save();
          this.recomputeDirty();
          appEvents.emit(AppEvent.SidebarReload);
          showNotification("All changes discarded", { type: "warning" });

          if (paths.includes(this.currentPath)) {
            const raw = (await provider?.readFile(this.currentPath)) || "";
            const { frontmatter, body } = stripFrontmatter(raw);
            const page = repo.getOrCreate(this.currentPath);
            if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter);
            page.originalFrontmatter = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined;
            page.setBaseline(body);
            await this.editor.ensureEditor(body);
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
    const page = repo.get(path);
    const body = page?.bodyState.body ?? page?.bodyState.baseline;
    if (body && body.toLowerCase().includes(q)) {
      results.push({ path, snippets: extractSnippets(body, q) });
    }
  }
  return results;
}
