import { appEvents, AppEvent } from "@/stores/app-events";
import { pageRepository } from "@/repositories/pageRepository";
import { pendingOpsRepository } from "@/repositories/pendingOpsRepository";
import { Frontmatter } from "@/entities/Frontmatter";
import type { MetaPanelData } from "@/components/panels/meta-panel";
import { scheduleSave } from "@/stores/persistence";

/**
 * DirtyTrackingService — single sink for all dirty-state changes.
 *
 * Every edit (ProseMirror body change, frontmatter edit, flush, discard,
 * provider switch, …) funnels through here. It owns:
 *   - per-path debouncing of body edits,
 *   - baseline comparison via `Page`/`Body`,
 *   - the `meta.dirty` flag,
 *   - debounced cache persistence (via `persistence`),
 *   - emission of the authoritative `DirtyChanged` event.
 *
 * The counter is always recomputed from `pageRepository.getDirtyPaths()`, so the
 * displayed count can never diverge from the true dirty set — regardless of which
 * editor instance or code path produced the change.
 */
export class DirtyTrackingService {
  private unsubs: (() => void)[] = [];
  private pathResolver: () => string = () => "";

  /** Latest pending body edit per path, flushed on the trailing debounce. */
  private pendingBodies = new Map<string, string>();
  private bodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly BODY_DEBOUNCE_MS = 300;

  setPathResolver(resolver: () => string): void {
    this.pathResolver = resolver;
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

  // ── Event handlers ──

  private onEditorChanged(path: string, md: string): void {
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

        pageRepository.getOrCreate(path).setBody(body);
        this.recomputeAndEmit();
        scheduleSave();
      }, DirtyTrackingService.BODY_DEBOUNCE_MS),
    );
  }

  private onMetaDataChanged(data: MetaPanelData): void {
    const path = this.pathResolver();
    if (!path) return;

    const page = pageRepository.getOrCreate(path);
    page.frontmatter = Frontmatter.fromMeta(data);
    page.markDirty();

    this.recomputeAndEmit();
    scheduleSave();
  }

  // ── Public API for callers outside the event stream ──

  /** Recompute and emit the authoritative dirty state immediately. */
  recompute(): void {
    this.recomputeAndEmit();
  }

  /** Force any pending debounced body edits to flush now. */
  flush(): void {
    for (const [path, timer] of this.bodyTimers) {
      clearTimeout(timer);
      const body = this.pendingBodies.get(path);
      if (body !== undefined) {
        this.pendingBodies.delete(path);
        pageRepository.getOrCreate(path).setBody(body);
      }
    }
    this.bodyTimers.clear();
    this.recomputeAndEmit();
    scheduleSave();
  }

  // ── Recompute ──

  private recomputeAndEmit(): void {
    let totalBytes = 0;
    const dirtyPaths = pageRepository.getDirtyPaths();
    for (const p of dirtyPaths) {
      totalBytes += pageRepository.getOrCreate(p).bodyState.getDelta();
    }

    const count = dirtyPaths.length;
    const pendingCount = pendingOpsRepository.load().length;
    const isSingleDirty = count === 1 && pendingCount === 0;

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
