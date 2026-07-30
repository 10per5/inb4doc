export class Body {
  public body?: string;
  public baseline?: string;

  constructor(public readonly path: string) {}

  getDelta(): number {
    if (this.body !== undefined && this.baseline !== undefined) {
      return this.body.length - this.baseline.length;
    }
    if (this.body !== undefined) return this.body.length;
    return 0;
  }

  setBody(body: string): void {
    this.body = body;
  }

  cacheBody(body: string): void {
    this.body = body;
  }

  setBaseline(baseline: string): boolean | null {
    this.baseline = baseline;
    return null;
  }

}
