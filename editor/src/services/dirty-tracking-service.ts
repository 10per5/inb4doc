import { appEvents, AppEvent } from "@/stores/app-events";
import { pagesStore } from "@/stores/page-store";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps, PendingOpType, type PendingOp } from "@/entities/PendingOps";
import { Frontmatter } from "@/entities/Frontmatter";
import type { MetaPanelData } from "@/entities/Frontmatter";

export class DirtyTrackingService {
  private unsubs: (() => void)[] = [];
  private pathResolver: () => string = () => "";
  private pendingOps?: PendingOps;

  private pendingBodies = new Map<string, string>();
  private bodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly BODY_DEBOUNCE_MS = 300;

  setPathResolver(resolver: () => string): void {
    this.pathResolver = resolver;
  }

  setPendingOps(ops: PendingOps): void {
    this.pendingOps = ops;
  }

  start(): void {
    this.unsubs.push(
      appEvents.on(AppEvent.EditorChanged, ({ path, md }) => {
        this.onEditorChanged(path, md);
      }),
      appEvents.on(AppEvent.MetaDataChanged, ({ data }) => {
        this.onMetaDataChanged(data);
      }),
    );
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.bodyTimers.forEach((t) => clearTimeout(t));
    this.bodyTimers.clear();
    this.pendingBodies.clear();
  }

  private onEditorChanged(path: string, md: string): void {
    if (!this.pendingOps) return;
    const existing = this.bodyTimers.get(path);
    if (existing !== undefined) clearTimeout(existing);

    this.pendingBodies.set(path, md);
    this.bodyTimers.set(
      path,
      setTimeout(() => {
        this.bodyTimers.delete(path);
        const body = this.pendingBodies.get(path);
        if (body === undefined) return;
        this.pendingBodies.delete(path);

        const createOp = this.pendingOps!.findCreate(path);
        if (createOp) {
          const page = pagesStore.getOrCreate(path);
          page.bodyState.setBody(body);
          const full = page.reconstructContent() ?? body;
          this.pendingOps!.queueCreate(path, full);
          pendingOpsStore.save(this.pendingOps!.all);
          return;
        }

        const editOp = this.pendingOps!.findEdit(path);
        if (editOp) {
          editOp.patch = body;
        } else {
          this.pendingOps!.queueEdit(path, body);
        }
        pendingOpsStore.save(this.pendingOps!.all);

        this.recomputeAndEmit();
      }, DirtyTrackingService.BODY_DEBOUNCE_MS),
    );
  }

  private onMetaDataChanged(data: MetaPanelData): void {
    if (!this.pendingOps) return;
    const path = this.pathResolver();
    if (!path) return;

    const page = pagesStore.getOrCreate(path);
    page.frontmatter = Frontmatter.fromMeta(data);

    const createOp = this.pendingOps.findCreate(path);
    if (createOp) {
      const full = page.reconstructContent() ?? "";
      this.pendingOps.queueCreate(path, full);
      pendingOpsStore.save(this.pendingOps.all);
      return;
    }

    const editOp = this.pendingOps.findEdit(path);
    if (editOp) {
      const original = page.originalFrontmatter?.toMeta();
      const changed: Record<string, string | number | undefined> = {}
      for (const key of Object.keys({ ...data, ...original })) {
        if (data[key as keyof MetaPanelData] !== original?.[key as keyof MetaPanelData]) {
          changed[key] = data[key as keyof MetaPanelData]
        }
      }
      editOp.frontmatterPatch = Object.keys(changed).length > 0 ? changed : undefined
    } else {
      const original = page.originalFrontmatter?.toMeta();
      const changed: Record<string, string | number | undefined> = {}
      for (const key of Object.keys({ ...data, ...original })) {
        if (data[key as keyof MetaPanelData] !== original?.[key as keyof MetaPanelData]) {
          changed[key] = data[key as keyof MetaPanelData]
        }
      }
      this.pendingOps.queueEdit(path, page.bodyState.body ?? "", Object.keys(changed).length > 0 ? changed : undefined)
    }
    pendingOpsStore.save(this.pendingOps.all);

    this.recomputeAndEmit();
  }

  recompute(): void {
    this.recomputeAndEmit();
  }

  flush(): void {
    if (!this.pendingOps) return;
    for (const [path, timer] of this.bodyTimers) {
      clearTimeout(timer);
      const body = this.pendingBodies.get(path);
      if (body === undefined) continue;
      this.pendingBodies.delete(path);

      const createOp = this.pendingOps.findCreate(path);
      if (createOp) {
        const page = pagesStore.getOrCreate(path);
        page.bodyState.setBody(body);
        const full = page.reconstructContent() ?? body;
        this.pendingOps.queueCreate(path, full);
        pendingOpsStore.save(this.pendingOps.all);
        continue;
      }

      const editOp = this.pendingOps.findEdit(path);
      if (editOp) {
        editOp.patch = body;
      } else {
        this.pendingOps.queueEdit(path, body);
      }
      pendingOpsStore.save(this.pendingOps.all);
    }
    this.bodyTimers.clear();
    this.recomputeAndEmit();
  }

  private recomputeAndEmit(): void {
    if (!this.pendingOps) return;
    let totalBytes = 0;
    const dirtyPaths = this.pendingOps.getDirtyPaths();
    for (const p of dirtyPaths) {
      const editOp = this.pendingOps.findEdit(p);
      if (editOp) {
        totalBytes += editOp.patch.length;
      } else {
        const page = pagesStore.get(p);
        const baseline = page?.bodyState.baseline;
        if (baseline) totalBytes += baseline.length;
      }
    }

    const count = dirtyPaths.length;
    const pendingCount = this.pendingOps.all.filter(o => o.type !== PendingOpType.Edit).length;
    const isSingleDirty = count === 1 && pendingCount <= 1;

    appEvents.emit(AppEvent.DirtyChanged, {
      count,
      bytes: totalBytes,
      pendingCount,
      singleDirtyPath: isSingleDirty ? dirtyPaths[0] : undefined,
      currentPath: this.pathResolver(),
      dirtyPaths,
    });
  }
}

export const dirtyTrackingService = new DirtyTrackingService();
