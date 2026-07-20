import * as diff from "diff";

/**
 * The editable body of a page: current body, original baseline, and the diff
 * (patch) between them. Owns the diff computation so `Page` doesn't have to.
 *
 * The patch is computed lazily — `setBody()` marks it stale and the full
 * unified-diff string is produced on first read of `patch` (via getter) and
 * cached until the next `setBody()` or `deletePatch()` call. The length delta
 * shown in the changes dialog is derived on read in `getDelta()`.
 */
export class Body {
  public body?: string;
  public baseline?: string;

  private _patch?: string;
  private _patchStale = false;

  constructor(public readonly path: string) {}

  /**
   * Length delta between body and baseline (0 when equal or absent).
   *
   * Derived on read rather than read from the cached `_delta` so it stays
   * correct after a `Page.decode()` restore, where `_delta` is not serialized
   * and would otherwise be left at 0 — making the changes dialog show a
   * misleading "+0 B" for every restored edit.
   */
  getDelta(): number {
    if (this.body !== undefined && this.baseline !== undefined) {
      return this.body.length - this.baseline.length;
    }
    if (this.body !== undefined) return this.body.length;
    return 0;
  }

  /**
   * Whether a non-empty patch exists, **without** triggering the expensive
   * `diff.createPatch` computation. Safe to call on every keystroke.
   */
  hasPatch(): boolean {
    if (this._patch !== undefined && !this._patchStale) return true;
    return this.baseline !== undefined && this.body !== undefined && this.body !== this.baseline;
  }

  /**
   * Lazily computed unified-diff patch between baseline and body.
   * Computed once per `setBody()` cycle and cached until the body changes.
   * Reading this triggers `diff.createPatch` on first access after a mutation.
   */
  get patch(): string | undefined {
    if (this._patchStale) {
      if (this.baseline !== undefined && this.body !== undefined && this.body !== this.baseline) {
        this._patch = diff.createPatch(this.path, this.baseline, this.body, "", "", { context: 3 });
      } else {
        this._patch = undefined;
      }
      this._patchStale = false;
    }
    return this._patch;
  }

  /** Direct setter — used by `Page.decode()` to restore a persisted patch. */
  set patch(value: string | undefined) {
    this._patch = value;
    this._patchStale = false;
  }

  setBody(body: string): void {
    this.body = body;
    this._patch = undefined;
    this._patchStale = true;
  }

  cacheBody(body: string): void {
    this.body = body;
  }

  /**
   * Set the baseline and re-apply any pending patch.
   * @returns true if a patch was applied, false if it failed to apply, null if none.
   */
  setBaseline(baseline: string): boolean | null {
    this.baseline = baseline;
    const p = this.patch; // triggers lazy computation
    if (!p) return null;
    const result = diff.applyPatch(baseline, p);
    if (typeof result === "string") {
      this.body = result;
      return true;
    }
    this._patch = undefined;
    this._patchStale = false;
    return false;
  }

  deletePatch(): void {
    this._patch = undefined;
    this._patchStale = false;
    this.body = undefined;
  }
}
