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
        const baseline = pagesStore.get(path)?.bodyState.baseline;
        if (editOp) {
          if (body === baseline && !editOp.frontmatterPatch) {
            this.pendingOps!.remove(path);
          } else {
            editOp.patch = body;
          }
        } else if (body !== baseline) {
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
      const baseline = pagesStore.get(path)?.bodyState.baseline;
      if (editOp) {
        if (body === baseline && !editOp.frontmatterPatch) {
          this.pendingOps.remove(path);
        } else {
          editOp.patch = body;
        }
      } else if (body !== baseline) {
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
    let singlePath: string | undefined;

    for (const op of this.pendingOps.all) {
      if (singlePath === undefined) {
        singlePath = "path" in op ? op.path : op.from;
      }
      switch (op.type) {
        case PendingOpType.Edit: {
          const page = pagesStore.get(op.path);
          totalBytes +=
            (op.patch?.length ?? 0) - (page?.bodyState.baseline?.length ?? 0);
          break;
        }
        case PendingOpType.Create:
          totalBytes += op.content.length;
          break;
        default:
          break;
      }
    }

    const count = this.pendingOps.count;
    const dirtyPaths = this.pendingOps.getDirtyPaths();

    appEvents.emit(AppEvent.DirtyChanged, {
      count,
      bytes: totalBytes,
      singleDirtyPath: count === 1 ? singlePath : undefined,
      currentPath: this.pathResolver(),
      dirtyPaths,
    });
  }
}

export const dirtyTrackingService = new DirtyTrackingService();
