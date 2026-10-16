import { appEvents, AppEvent } from "@/stores/app-events";
import { pagesStore } from "@/stores/page-store";
import { pendingOpsStore } from "@/stores/pending-ops-store";
import { PendingOps, PendingOpType, type PendingOp } from "@/entities/PendingOps";
import { Frontmatter } from "@/entities/Frontmatter";
import type { MetaPanelData } from "@/entities/Frontmatter";
import { merge3 } from "@/utils/merge3";

export class DirtyTrackingService {
  private unsubs: (() => void)[] = [];
  private pathResolver: () => string = () => "";
  private canonicalBaselineResolver: (path: string) => string | undefined =
    () => undefined;
  private pendingOps?: PendingOps;

  private pendingBodies = new Map<string, string>();
  private bodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly BODY_DEBOUNCE_MS = 300;

  setPathResolver(resolver: () => string): void {
    this.pathResolver = resolver;
  }

  /** Supplies C0 (canonical at load) for a path; used for per-section merges. */
  setCanonicalBaselineResolver(resolver: (path: string) => string | undefined): void {
    this.canonicalBaselineResolver = resolver;
  }

  setPendingOps(ops: PendingOps): void {
    this.pendingOps = ops;
  }

  start(): void {
    this.unsubs.push(
      appEvents.on(AppEvent.EditorChanged, ({ path, md, baseCanonical }) => {
        this.onEditorChanged(path, md, baseCanonical);
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

  private onEditorChanged(path: string, md: string, baseCanonicalFromEvent?: string): void {
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
        const c0 = baseCanonicalFromEvent ?? this.canonicalBaselineResolver(path);
        if (editOp) {
          if (body === baseline && !editOp.frontmatterPatch) {
            this.pendingOps!.remove(path);
          } else {
            editOp.patch = body;
            if (editOp.fullFormat) {
              editOp.baseCanonical = undefined;
            } else if (editOp.baseCanonical === undefined && c0 !== undefined) {
              // Capture C0 once; later events carry the running canonical, not C0.
              editOp.baseCanonical = c0;
            }
          }
        } else if (body !== baseline) {
          this.pendingOps!.queueEdit(path, body, undefined, undefined, c0);
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

    const original = page.originalFrontmatter?.toMeta();
    const changed: Record<string, string | number | undefined> = {}
    for (const key of Object.keys({ ...data, ...original })) {
      if (data[key as keyof MetaPanelData] !== original?.[key as keyof MetaPanelData]) {
        changed[key] = data[key as keyof MetaPanelData]
      }
    }
    const frontmatterPatch = Object.keys(changed).length > 0 ? changed : undefined

    const baseline = page.bodyState.baseline;
    const bodyChanged =
      baseline !== undefined && (page.bodyState.body ?? "") !== baseline;

    const editOp = this.pendingOps.findEdit(path);
    if (editOp) {
      editOp.frontmatterPatch = frontmatterPatch;
      if (!frontmatterPatch && !bodyChanged) {
        this.pendingOps.remove(path);
      }
    } else if (frontmatterPatch || bodyChanged) {
      this.pendingOps.queueEdit(
        path,
        page.bodyState.body ?? "",
        frontmatterPatch,
        undefined,
        this.canonicalBaselineResolver(path)
      );
    }
    pendingOpsStore.save(this.pendingOps.all);

    this.recomputeAndEmit();
  }

  recompute(): void {
    this.recomputeAndEmit();
  }

  /**
   * Whole-file format: queue a single intentional Edit (or refresh the pending
   * Create) carrying the canonical serialization of the current doc. Unlike the
   * per-keystroke path this runs immediately (no debounce); it is explicitly
   * user-initiated, so it must never be confused with the open-time auto-format
   * this feature replaced. `md` is the editor's canonical serialization.
   */
  formatDocument(path: string, md: string): void {
    if (!this.pendingOps) return;
    const page = pagesStore.getOrCreate(path);
    page.bodyState.setBody(md);

    const createOp = this.pendingOps.findCreate(path);
    if (createOp) {
      const full = page.reconstructContent() ?? md;
      this.pendingOps.queueCreate(path, full);
    } else {
      const editOp = this.pendingOps.findEdit(path);
      const baseline = page.bodyState.baseline;
      if (editOp) {
        editOp.patch = md;
        editOp.fullFormat = true;
        editOp.baseCanonical = undefined;
      } else if (baseline !== undefined && md !== baseline) {
        this.pendingOps.queueEdit(path, md, undefined, undefined, undefined, true);
      }
    }
    pendingOpsStore.save(this.pendingOps.all);
    this.recomputeAndEmit();
    appEvents.emit(AppEvent.FormatSuggestionChanged, { path, formattable: false });
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
          if (
            !editOp.fullFormat &&
            editOp.baseCanonical === undefined
          ) {
            const c0 = this.canonicalBaselineResolver(path);
            if (c0 !== undefined) editOp.baseCanonical = c0;
          }
        }
      } else if (body !== baseline) {
        this.pendingOps.queueEdit(
          path,
          body,
          undefined,
          undefined,
          this.canonicalBaselineResolver(path)
        );
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
          const baseline = page?.bodyState.baseline;
          const base = baseline?.length ?? 0;
          const c0 =
            op.baseCanonical ?? this.canonicalBaselineResolver(op.path);
          if (
            baseline !== undefined &&
            c0 !== undefined &&
            !op.fullFormat
          ) {
            // The actual write preserves the raw formatting of untouched
            // blocks, so size the merged body — not the full canonical patch.
            totalBytes += merge3(baseline, c0, op.patch).merged.length - base;
          } else {
            totalBytes += (op.patch?.length ?? 0) - base;
          }
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
