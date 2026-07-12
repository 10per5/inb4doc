import * as diff from "diff";

/**
 * The editable body of a page: current body, original baseline, and the diff
 * (patch) between them. Owns the diff computation so `Page` doesn't have to.
 */
export class Body {
  public body?: string;
  public baseline?: string;
  public patch?: string;

  constructor(public readonly path: string) {}

  /** Length delta between body and baseline (0 when equal or absent). */
  getDelta(): number {
    if (this.body !== undefined && this.baseline !== undefined) {
      return this.body.length - this.baseline.length;
    }
    if (this.body !== undefined) return this.body.length;
    return 0;
  }

  setBody(body: string): void {
    this.body = body;
    this.patch =
      this.baseline !== undefined
        ? diff.createPatch(this.path, this.baseline, body, "", "", { context: 3 })
        : undefined;
    if (this.getDelta() === 0) this.patch = undefined;
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
    if (!this.patch) return null;
    const result = diff.applyPatch(baseline, this.patch);
    if (typeof result === "string") {
      this.body = result;
      return true;
    }
    this.patch = undefined;
    return false;
  }

  deletePatch(): void {
    this.patch = undefined;
    this.body = undefined;
  }

  hasPatch(): boolean {
    return this.patch !== undefined;
  }
}
