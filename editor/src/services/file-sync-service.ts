import { stripFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import {
  Frontmatter,
  type MetaPanelData,
} from "@/entities/Frontmatter";
import {
  openChangesDialog,
  type ChangesDialogItem,
} from "@/controllers/dialog/changes-dialog";
import { pagesStore } from "@/stores/page-store";
import {
  PendingOps,
  PendingOpType,
  type PendingOp,
} from "@/entities/PendingOps";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { getProvider, activeProviderId } from "@/stores/provider-store";
import { treeStore } from "@/stores/tree-store";
import { showNotification } from "@/components/notification/notification";
import type { TreeIndex } from "@/utils/tree";
import { extractSnippets } from "@/utils/content-search";
import { imageService } from "@/services/image-service";
import { storageService } from "@/services/storage";
import { STORE_FILES } from "@/config/storage-keys";
import { pagesStore as repo } from "@/stores/page-store";
import { appEvents, AppEvent } from "@/stores/app-events";
import { dirtyTrackingService } from "@/services/dirty-tracking-service";
import { clearEditorTint, updateEditorTint } from "@/services/file-status-tint";

import type { EditorController } from "@/controllers/editor-controller";

export interface SearchMatch {
  path: string;
  snippets: string[];
}

export class FileSyncService {
  private editor: EditorController;
  private currentPath: string = "";
  private pendingOps: PendingOps;
  private unsubs: (() => void)[] = [];

  constructor(editor: EditorController) {
    this.editor = editor;
    this.pendingOps = new PendingOps(pendingOpsStore.load());
    dirtyTrackingService.setPendingOps(this.pendingOps);
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
    pendingOpsStore.save(this.pendingOps.all);
  }

  queueDelete(path: string): void {
    this.pendingOps.queueDelete(path);
    pendingOpsStore.save(this.pendingOps.all);
  }

  cancelCreate(path: string): void {
    this.pendingOps.cancelCreate(path);
    pendingOpsStore.save(this.pendingOps.all);
  }

  queueRename(from: string, to: string): void {
    const content = repo.getOrCreate(from).reconstructContent() ?? undefined;
    this.pendingOps.queueRename(from, to, content);
    pendingOpsStore.save(this.pendingOps.all);
    const fromDir = from.includes("/")
      ? from.substring(0, from.lastIndexOf("/"))
      : "";
    const toDir = to.includes("/") ? to.substring(0, to.lastIndexOf("/")) : "";
    if (fromDir !== toDir) {
      imageService.remapDir(fromDir, toDir).catch(() => {});
    }
  }

  queueMove(from: string, to: string, content?: string): void {
    const finalContent =
      content ?? repo.getOrCreate(from).reconstructContent() ?? undefined;
    this.pendingOps.queueMove(from, to, finalContent);

    repo.clearPath(to);
    const toPage = repo.getOrCreate(to);
    const fromPage = repo.get(from);
    if (fromPage) {
      if (fromPage.bodyState.body !== undefined)
        toPage.bodyState.cacheBody(fromPage.bodyState.body);
      if (fromPage.bodyState.baseline !== undefined)
        toPage.bodyState.setBaseline(fromPage.bodyState.baseline);
      if (fromPage.frontmatter) toPage.frontmatter = fromPage.frontmatter;
    }
    repo.clearPath(from);

    pendingOpsStore.save(this.pendingOps.all);
    const fromDir = from.includes("/")
      ? from.substring(0, from.lastIndexOf("/"))
      : "";
    const toDir = to.includes("/") ? to.substring(0, to.lastIndexOf("/")) : "";
    if (fromDir !== toDir) {
      imageService.remapDir(fromDir, toDir).catch(() => {});
    }
  }

  getPendingOpsCount(): number {
    return this.pendingOps.count;
  }

  async afterRestore(): Promise<void> {
    const blobToRef = new Map<string, string>();
    for (const dir of imageService.getAllPendingDirs()) {
      for (const p of imageService.getPending(dir)) {
        if (p.blobUrl) blobToRef.set(p.blobUrl, `pending-image:${p.id}`);
      }
    }
    if (blobToRef.size === 0) return;

    for (const path of this.pendingOps.getDirtyPaths()) {
      const page = repo.getOrCreate(path);
      if (!page.bodyState.body) continue;
      let modified = false;
      let newBody = page.bodyState.body;
      for (const [blobUrl, ref] of blobToRef) {
        if (newBody.includes(blobUrl)) {
          newBody = newBody.split(blobUrl).join(ref);
          modified = true;
        }
      }
      if (modified) {
        const editOp = this.pendingOps.findEdit(path);
        if (editOp) {
          editOp.patch = newBody;
        } else {
          this.pendingOps.queueEdit(path, newBody);
        }
        pendingOpsStore.save(this.pendingOps.all);
      }
    }
  }

  async pathExists(path: string): Promise<boolean> {
    if (this.pendingOps.hasPendingDelete(path)) return false;
    if (this.pendingOps.hasPendingCreate(path)) return true;
    if (this.pendingOps.hasPendingMoveTo(path)) return true;

    try {
      const tree = treeStore.getTree();
      return tree.paths.has(path) || tree.paths.has(path + ".md");
    } catch {}

    return false;
  }

  clearPendingOps(): void {
    this.pendingOps.clear();
    pendingOpsStore.clear();
  }

  createDraft(path: string, content: string): void {
    this.queueCreate(path, content);
    const page = repo.getOrCreate(path);
    const { frontmatter, body } = stripFrontmatter(content);
    if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter);
    page.setBody(body);
    page.setBaseline(body);
  }

  applyPendingOpsToTree(tree: TreeIndex): TreeIndex {
    return this.pendingOps.applyToTree(tree);
  }

  private recomputeDirty(): void {
    dirtyTrackingService.recompute();
  }

  // ── Flush ──

  async flushCurrentFile(path: string, content: string): Promise<void> {
    const imageUrlMap = await imageService.commitAllPendingImages();
    const page = repo.getOrCreate(path);
    page.setBody(content);

    const ok = await page.flushOut(imageUrlMap);
    if (ok) {
      treeStore.afterWrite(path, page.reconstructContent());
      this.pendingOps.cancelEdit(path);
      pendingOpsStore.save(this.pendingOps.all);
      this.recomputeDirty();
      showNotification("File saved", { type: "success" });
    } else {
      showNotification("Failed to save", { type: "danger" });
    }
  }

  async flushDirtyFiles(): Promise<void> {
    const dirtyPaths = this.pendingOps.getDirtyPaths();
    if (dirtyPaths.length === 0 && this.pendingOps.count === 0) return;

    const currentMd = this.editor.getCurrentContent();
    const provider = getProvider();

    const imageUrlMap = await imageService.commitAllPendingImages();

    for (const path of dirtyPaths) {
      const page = repo.getOrCreate(path);
      const editOp = this.pendingOps.findEdit(path);

      let bodyToWrite: string;
      if (editOp) {
        bodyToWrite = editOp.patch ?? page.bodyState.body ?? "";
      } else {
        bodyToWrite = page.bodyState.body ?? "";
      }

      if (path === this.currentPath) {
        bodyToWrite = currentMd;
      } else if (!editOp && !bodyToWrite) {
        const cachedRaw = await provider?.readFile(path);
        if (!cachedRaw) continue;
        bodyToWrite = stripFrontmatter(cachedRaw).body;
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

      page.setBody(bodyToWrite);
      await page.flushOut(imageUrlMap);
      this.pendingOps.cancelEdit(path);
    }

    const flushedPaths = new Set(dirtyPaths);
    const { deletedPaths, renamedPaths } = await this.executePendingOps(
      flushedPaths
    );

    pendingOpsStore.save(this.pendingOps.all);

    this.recomputeDirty();

    appEvents.emit(AppEvent.FlushComplete);

    const renamedTo = renamedPaths.get(this.currentPath);
    if (renamedTo) {
      appEvents.emit(AppEvent.Navigate, { path: renamedTo });
    } else if (deletedPaths.includes(this.currentPath)) {
      const raw = await provider?.readFile(this.currentPath);
      if (!raw) {
        clearEditorTint(this.editor.element as HTMLElement);
        appEvents.emit(AppEvent.NoFileView, { lastPath: this.currentPath });
      } else {
        updateEditorTint(
          this.editor.element as HTMLElement,
          this.currentPath,
          this.pendingOps
        );
      }
    } else {
      updateEditorTint(
        this.editor.element as HTMLElement,
        this.currentPath,
        this.pendingOps
      );
    }

    showNotification("All files saved", { type: "success" });

    this.cleanupOrphanedImages(dirtyPaths, provider).catch(() => {});
  }

  private async executeOp(
    op: PendingOp,
    flushedPaths?: Set<string>
  ): Promise<void> {
    const provider = getProvider();
    const providerId = activeProviderId();

    switch (op.type) {
      case PendingOpType.Create: {
        const latest =
          repo.get(op.path)?.reconstructContent() ?? op.content;
        await provider?.writeFile(op.path, latest);
        treeStore.afterWrite(op.path, latest);
        const page = repo.get(op.path);
        if (page && page.bodyState.body !== undefined) {
          page.setBaseline(page.bodyState.body);
        }
        break;
      }
      case PendingOpType.Delete: {
        await provider?.deleteFile?.(op.path);
        storageService.removeEntity(
          STORE_FILES,
          `${providerId}/${op.path}`
        );
        if (!op.path.endsWith("/_index")) {
          const indexPath = op.path + "/_index";
          await provider?.deleteFile?.(indexPath).catch(() => {});
          storageService.removeEntity(
            STORE_FILES,
            `${providerId}/${indexPath}`
          );
        }
        treeStore.afterDelete(op.path);
        break;
      }
      case PendingOpType.Rename:
        if (op.content) {
          await provider?.deleteFile?.(op.from);
          if (!flushedPaths?.has(op.to)) {
            const latest =
              repo.get(op.to)?.reconstructContent() ?? op.content;
            await provider?.writeFile?.(op.to, latest);
          }
        } else {
          await provider?.moveFile?.(op.from, op.to);
        }
        treeStore.afterMove(op.from, op.to, op.content);
        storageService.removeEntity(
          STORE_FILES,
          `${providerId}/${op.from}`
        );
        break;
      case PendingOpType.Move:
        if (op.content) {
          await provider?.deleteFile?.(op.from);
          if (!flushedPaths?.has(op.to)) {
            const latest =
              repo.get(op.to)?.reconstructContent() ?? op.content;
            await provider?.writeFile?.(op.to, latest);
          }
        } else {
          await provider?.moveFile?.(op.from, op.to);
        }
        treeStore.afterMove(op.from, op.to, op.content);
        storageService.removeEntity(
          STORE_FILES,
          `${providerId}/${op.from}`
        );
        break;
      case PendingOpType.Edit:
        break;
    }
  }

  private async executePendingOps(
    flushedPaths?: Set<string>
  ): Promise<{ deletedPaths: string[]; renamedPaths: Map<string, string> }> {
    if (this.pendingOps.count === 0)
      return { deletedPaths: [], renamedPaths: new Map() };
    const deletedPaths: string[] = [];
    const renamedPaths = new Map<string, string>();

    const sorted = [...this.pendingOps.all].sort((a, b) => {
      const order: Record<PendingOpType, number> = {
        [PendingOpType.Create]: 0,
        [PendingOpType.Edit]: 0,
        [PendingOpType.Move]: 1,
        [PendingOpType.Rename]: 1,
        [PendingOpType.Delete]: 2,
      };
      return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    });

    for (const op of sorted) {
      try {
        await this.executeOp(op, flushedPaths);
        if (op.type === PendingOpType.Delete) deletedPaths.push(op.path);
        if (op.type === PendingOpType.Rename)
          renamedPaths.set(op.from, op.to);
      } catch (error) {
        console.error(
          `Failed to execute pending op ${op.type} ${
            "path" in op ? op.path : op.from
          }:`,
          error
        );
      }
    }

    this.pendingOps.clear();
    pendingOpsStore.clear();
    return { deletedPaths, renamedPaths };
  }

  private async cleanupOrphanedImages(
    dirtyPaths: string[],
    provider: any
  ): Promise<void> {
    const dirs = new Set(
      dirtyPaths.map((p) =>
        p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ""
      )
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
    this.pendingOps.cancelOp(pagePath);
    pendingOpsStore.save(this.pendingOps.all);
    repo.clearPath(pagePath);
    this.recomputeDirty();
    this.editor.invalidateState(pagePath);

    if (pagePath === this.currentPath) {
      await this.reloadCurrentFromDisk(pagePath);
    }

    showNotification("Changes discarded", { type: "info" });
  }

  private async reloadCurrentFromDisk(pagePath: string): Promise<void> {
    clearEditorTint(this.editor.element as HTMLElement);
    const provider = getProvider();
    const raw = (await provider?.readFile(pagePath)) || "";

    if (!raw) {
      appEvents.emit(AppEvent.NoFileView, { lastPath: pagePath });
    } else {
      const { frontmatter, body } = stripFrontmatter(raw);
      const page = repo.getOrCreate(pagePath);
      if (frontmatter) page.frontmatter = Frontmatter.fromMeta(frontmatter);
      page.originalFrontmatter = frontmatter
        ? Frontmatter.fromMeta(frontmatter)
        : undefined;
      page.setBaseline(body);
      page.bodyState.body = body;

      await this.editor.ensureEditor(body);
    }
  }

  // ── Single-op approve / reject ──

  private async flushPendingEdit(path: string): Promise<boolean> {
    const provider = getProvider();
    const imageUrlMap = await imageService.commitAllPendingImages();
    const page = repo.getOrCreate(path);
    const editOp = this.pendingOps.findEdit(path);

    let bodyToWrite: string;
    if (editOp) {
      bodyToWrite = editOp.patch ?? page.bodyState.body ?? "";
    } else {
      bodyToWrite = page.bodyState.body ?? "";
    }

    if (path === this.currentPath) {
      bodyToWrite = this.editor.getCurrentContent();
    } else if (!editOp && !bodyToWrite) {
      const cachedRaw = await provider?.readFile(path);
      if (!cachedRaw) return false;
      bodyToWrite = stripFrontmatter(cachedRaw).body;
    }

    if (path === this.currentPath) {
      const serverTime = page.getServerTime();
      if (serverTime) {
        const fileTime = await provider?.getServerTime(path);
        if (fileTime && fileTime > serverTime) {
          if (!confirm(`"${path}" was modified on disk. Overwrite?`))
            return false;
        }
      }
    }

    page.setBody(bodyToWrite);
    const ok = await page.flushOut(imageUrlMap);
    if (ok) {
      treeStore.afterWrite(path, page.reconstructContent());
      this.pendingOps.cancelEdit(path);
    }
    return ok;
  }

  async approveOp(path: string): Promise<void> {
    const op = this.pendingOps.get(path);
    if (!op) return;
    const provider = getProvider();
    const affected = "path" in op ? op.path : op.from;

    try {
      if (op.type === PendingOpType.Edit) {
        const ok = await this.flushPendingEdit(op.path);
        if (!ok) {
          showNotification("Failed to save", { type: "danger" });
          return;
        }
      } else {
        await this.executeOp(op);
        this.pendingOps.cancelOp(affected);
      }
    } catch (error) {
      console.error(`Failed to apply change for ${path}:`, error);
      showNotification("Failed to apply change", { type: "danger" });
      return;
    }

    pendingOpsStore.save(this.pendingOps.all);
    this.recomputeDirty();
    appEvents.emit(AppEvent.SidebarReload);

    if (op.type === PendingOpType.Rename || op.type === PendingOpType.Move) {
      if (op.to === this.currentPath) {
        appEvents.emit(AppEvent.Navigate, { path: op.to });
      } else if (affected === this.currentPath) {
        await this.reloadCurrentFromDisk(this.currentPath);
      } else {
        updateEditorTint(
          this.editor.element as HTMLElement,
          this.currentPath,
          this.pendingOps
        );
      }
    } else if (affected === this.currentPath) {
      const raw = await provider?.readFile(this.currentPath);
      if (!raw) {
        clearEditorTint(this.editor.element as HTMLElement);
        appEvents.emit(AppEvent.NoFileView, { lastPath: this.currentPath });
      } else {
        await this.reloadCurrentFromDisk(this.currentPath);
      }
    } else {
      updateEditorTint(
        this.editor.element as HTMLElement,
        this.currentPath,
        this.pendingOps
      );
    }

    showNotification("Change applied", { type: "success" });
  }

  async rejectOp(path: string): Promise<void> {
    const op = this.pendingOps.get(path);
    if (!op) return;
    const affected = "path" in op ? op.path : op.from;

    this.pendingOps.cancelOp(affected);
    pendingOpsStore.save(this.pendingOps.all);
    repo.clearPath(affected);
    this.editor.invalidateState(affected);
    this.recomputeDirty();
    appEvents.emit(AppEvent.SidebarReload);

    if (affected === this.currentPath) {
      await this.reloadCurrentFromDisk(this.currentPath);
    } else {
      updateEditorTint(
        this.editor.element as HTMLElement,
        this.currentPath,
        this.pendingOps
      );
    }

    showNotification("Change rejected", { type: "info" });
  }

  // ── Changes dialog ──

  async handleDirtyClick(): Promise<void> {
    if (this.pendingOps.count === 0) return;

    const provider = getProvider();
    const items: ChangesDialogItem[] = [];

    const sorted = [...this.pendingOps.all].sort((a, b) => {
      const order: Record<PendingOpType, number> = {
        [PendingOpType.Create]: 0,
        [PendingOpType.Edit]: 0,
        [PendingOpType.Move]: 1,
        [PendingOpType.Rename]: 1,
        [PendingOpType.Delete]: 2,
      };
      return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    });

    for (const op of sorted) {
      switch (op.type) {
        case PendingOpType.Edit: {
          const page = repo.getOrCreate(op.path);
          if (op.patch !== undefined) page.bodyState.body = op.patch;

          let body = page.bodyState.body;
          if (op.path === this.currentPath) {
            body = this.editor.getCurrentContent();
          }

          let fm: MetaPanelData | undefined =
            page.getFrontmatter() ?? page.originalFrontmatter?.toMeta();
          if (fm === undefined && op.frontmatterPatch) {
            fm = {
              ...(page.originalFrontmatter?.toMeta() ?? {}),
              ...op.frontmatterPatch,
            } as MetaPanelData;
          }

          let md: string | undefined;
          if (body !== undefined) {
            md = fm
              ? `---\n${serializeFrontmatter(fm)}\n---\n\n${body}`
              : body;
          }

          if (md === undefined) {
            const cachedRaw = await provider?.readFile(op.path);
            if (!cachedRaw) continue;
            const { frontmatter: rawFm, body: rawBody } =
              stripFrontmatter(cachedRaw);
            const fallbackPage = repo.getOrCreate(op.path);
            fallbackPage.setBaseline(rawBody);
            fallbackPage.originalFrontmatter = rawFm
              ? Frontmatter.fromMeta(rawFm)
              : undefined;
            const diskFm = fallbackPage.getFrontmatter() ?? rawFm;
            md = diskFm
              ? `---\n${serializeFrontmatter(diskFm)}\n---\n\n${rawBody}`
              : rawBody;
          }

          if (md === undefined) continue;

          const changeSize =
            op.patch.length - (page.bodyState.baseline?.length ?? 0);

          items.push({
            path: op.path,
            label: op.path,
            kind: PendingOpType.Edit,
            currentPath: op.path === this.currentPath,
            md,
            size: changeSize,
          });
          break;
        }
        case PendingOpType.Create: {
          const page = repo.get(op.path);
          const md = page?.reconstructContent() ?? op.content;
          items.push({
            path: op.path,
            label: `Create: ${op.path}`,
            kind: PendingOpType.Create,
            currentPath: op.path === this.currentPath,
            md,
            size: md.length,
          });
          break;
        }
        case PendingOpType.Delete:
          items.push({
            path: op.path,
            label: `Delete: ${op.path}`,
            kind: PendingOpType.Delete,
            currentPath: op.path === this.currentPath,
            md: "",
            size: 0,
          });
          break;
        case PendingOpType.Rename:
          items.push({
            path: op.from,
            label: `Rename: ${op.from} → ${op.to}`,
            kind: PendingOpType.Rename,
            currentPath: op.from === this.currentPath,
            ...(op.content
              ? { md: op.content, size: op.content.length }
              : { notice: `Rename: ${op.from} → ${op.to}`, size: 0 }),
          });
          break;
        case PendingOpType.Move:
          items.push({
            path: op.from,
            label: `Move: ${op.from} → ${op.to}`,
            kind: PendingOpType.Move,
            currentPath: op.from === this.currentPath,
            ...(op.content
              ? { md: op.content, size: op.content.length }
              : { notice: `Move: ${op.from} → ${op.to}`, size: 0 }),
          });
          break;
      }
    }

    if (items.length === 0) return;

    openChangesDialog(
      items,
      this.currentPath,
      {
        onApprove: (path) => {
          this.approveOp(path).catch(() => {});
        },
        onReject: (path) => {
          this.rejectOp(path).catch(() => {});
        },
        onLoadOriginal: async (path) => {
          const page = repo.getOrCreate(path);
          if (page.bodyState.baseline !== undefined) {
            if (page.originalFrontmatter) {
              return (
                "---\n" +
                page.originalFrontmatter.serialize() +
                "\n---\n\n" +
                page.bodyState.baseline
              );
            }
            return page.bodyState.baseline;
          }
          return (await provider?.readFile(path)) || "";
        },
        onFlushAll: () => this.flushDirtyFiles(),
        onDiscardAll: async () => {
          this.clearPendingOps();
          await imageService.removeAllForDir(imageService.getCurrentDocDir());
          this.recomputeDirty();
          appEvents.emit(AppEvent.SidebarReload);
          showNotification("All changes discarded", { type: "warning" });
          await this.reloadCurrentFromDisk(this.currentPath);
        },
      },
      () => {}
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
