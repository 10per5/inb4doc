import { pageDisplayName } from "@/utils/display-name";
import { stripFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import { getProvider } from "@/stores/provider-store";
import { replacePendingUrls } from "@/utils/text";
import { Body } from "./Body";
import { Frontmatter } from "./Frontmatter";
import type { PageMeta } from "./PageMeta";
import type { MetaPanelData } from "@/components/panels/meta-panel";

export interface PageData {
  body?: string;
  baseline?: string;
  patch?: string;
  serverTime?: number;
  frontmatter?: Record<string, string | number | undefined>;
  dirty?: boolean;
}

/**
 * A single content page — the aggregate root.
 *
 * Composes state from value objects (Body, Frontmatter, PageMeta); callers
 * read those directly. Page owns the mutators that coordinate body + dirty
 * flag, and the backend IO as its outer layer (flushIn / flushOut).
 */
export class Page {
  public readonly bodyState: Body;
  public meta: PageMeta;
  public frontmatter?: Frontmatter;

  constructor(public readonly path: string) {
    this.bodyState = new Body(path);
    this.meta = { dirty: false };
  }

  /** Display name, using frontmatter `title` when present (else filename). */
  get name(): string {
    return pageDisplayName(this.path, this.frontmatter?.title);
  }

  /** Compose stored frontmatter + body back into full Markdown. */
  reconstructContent(): string | undefined {
    if (this.bodyState.body === undefined) return undefined;
    if (this.frontmatter) {
      return "---\n" + this.frontmatter.serialize() + "\n---\n\n" + this.bodyState.body;
    }
    return this.bodyState.body;
  }

  /**
   * Set the body. A no-op change (delta 0) clears the dirty flag.
   */
  setBody(body: string): void {
    this.bodyState.setBody(body);
    this.meta.dirty = this.bodyState.patch !== undefined;
  }

  /**
   * Set the baseline and re-apply any pending patch, propagating the dirty
   * result (applied => dirty, failed => clean).
   */
  setBaseline(baseline: string): void {
    const applied = this.bodyState.setBaseline(baseline);
    if (applied === true) this.meta.dirty = true;
    else if (applied === false) this.meta.dirty = false;
  }

  /** Drop the pending patch + body and mark the page clean. */
  deletePatch(): void {
    this.bodyState.deletePatch();
    this.meta.dirty = false;
  }

  /** Set this page's frontmatter from raw editor metadata. */
  setFrontmatter(data: MetaPanelData): void {
    this.frontmatter = Frontmatter.fromMeta(data);
  }

  removeFrontmatter(): void {
    this.frontmatter = undefined;
  }

  /** Frontmatter presented as raw editor metadata (undefined if absent). */
  getFrontmatter(): MetaPanelData | undefined {
    return this.frontmatter?.toMeta();
  }

  setServerTime(time: number): void {
    this.meta.serverTime = time;
  }

  getServerTime(): number | undefined {
    return this.meta.serverTime;
  }

  markDirty(): void {
    this.meta.dirty = true;
  }

  encode(): PageData {
    return {
      body: this.bodyState.body,
      baseline: this.bodyState.baseline,
      patch: this.bodyState.patch,
      serverTime: this.meta.serverTime,
      frontmatter: this.frontmatter?.toMeta(),
      dirty: this.meta.dirty,
    };
  }

  static decode(path: string, data: PageData): Page {
    const page = new Page(path);
    if (data.body !== undefined) page.bodyState.body = data.body;
    if (data.baseline !== undefined) page.bodyState.baseline = data.baseline;
    if (data.patch !== undefined) page.bodyState.patch = data.patch;
    if (data.serverTime !== undefined) page.meta.serverTime = data.serverTime;
    if (data.frontmatter) page.frontmatter = Frontmatter.fromMeta(data.frontmatter as MetaPanelData);
    if (data.dirty) page.meta.dirty = true;
    return page;
  }

  /**
   * Flush-in: read the page's current server state and merge it into the page
   * as the new baseline + frontmatter + server time.
   *
   * Returns true on success, false if the file could not be read.
   */
  async flushIn(): Promise<boolean> {
    const provider = getProvider();
    try {
      const content = await provider.readFile(this.path);
      if (content == null) return false;

      const { frontmatter, body } = stripFrontmatter(content);
      this.setBaseline(body);
      this.frontmatter = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined;
      const time = await provider.getServerTime(this.path);
      if (time != null) this.meta.serverTime = time;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Flush-out: write the page's local body + frontmatter to the backend.
   *
   * If an `imageUrlMap` is provided, pending-image: references in the body
   * are replaced with the committed URLs before writing.
   *
   * After a successful write, the patch is cleared, the baseline is updated
   * to the written body, and the server time is refreshed.
   *
   * Returns true on success, false on failure.
   */
  async flushOut(imageUrlMap?: Map<string, string>): Promise<boolean> {
    const provider = getProvider();
    let body = this.bodyState.body;
    if (body == null) return false;

    if (imageUrlMap && imageUrlMap.size > 0) {
      body = replacePendingUrls(body, imageUrlMap);
    }

    const fmData = this.frontmatter?.toMeta();
    const fullContent = fmData
      ? `---\n${serializeFrontmatter(fmData)}\n---\n\n${body}`
      : body;

    try {
      await provider.writeFile(this.path, fullContent);
      this.deletePatch();
      this.setBaseline(body);
      this.bodyState.cacheBody(body);
      const fileTime = await provider.getServerTime(this.path);
      if (fileTime) this.setServerTime(fileTime);
      return true;
    } catch {
      return false;
    }
  }
}
