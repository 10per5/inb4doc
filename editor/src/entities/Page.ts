import { pageDisplayName } from "@/utils/display-name";
import { stripFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import { getProvider } from "@/stores/provider-store";
import { replacePendingUrls } from "@/utils/text";
import { Body } from "./Body";
import { Frontmatter } from "./Frontmatter";
import type { PageMeta } from "./PageMeta";
import type { MetaPanelData } from "@/entities/Frontmatter";

export interface PageData {
  body?: string;
  baseline?: string;
  serverTime?: number;
  frontmatter?: Record<string, string | number | undefined>;
  originalFrontmatter?: Record<string, string | number | undefined>;
}

export class Page {
  public readonly bodyState: Body;
  public meta: PageMeta;
  public frontmatter?: Frontmatter;
  public originalFrontmatter?: Frontmatter;

  constructor(public readonly path: string) {
    this.bodyState = new Body(path);
    this.meta = {};
  }

  get name(): string {
    return pageDisplayName(this.path, this.frontmatter?.title);
  }

  reconstructContent(): string | undefined {
    if (this.bodyState.body === undefined) return undefined;
    if (this.frontmatter) {
      return "---\n" + this.frontmatter.serialize() + "\n---\n\n" + this.bodyState.body;
    }
    return this.bodyState.body;
  }

  setBody(body: string): void {
    this.bodyState.setBody(body);
  }

  setBaseline(baseline: string): void {
    this.bodyState.baseline = baseline;
  }

  setFrontmatter(data: MetaPanelData): void {
    this.frontmatter = Frontmatter.fromMeta(data);
  }

  removeFrontmatter(): void {
    this.frontmatter = undefined;
  }

  getFrontmatter(): MetaPanelData | undefined {
    return this.frontmatter?.toMeta();
  }

  setServerTime(time: number): void {
    this.meta.serverTime = time;
  }

  getServerTime(): number | undefined {
    return this.meta.serverTime;
  }

  static decode(path: string, data: PageData): Page {
    const page = new Page(path);
    if (data.body !== undefined) page.bodyState.body = data.body;
    if (data.baseline !== undefined) page.bodyState.baseline = data.baseline;
    if (data.serverTime !== undefined) page.meta.serverTime = data.serverTime;
    if (data.frontmatter) page.frontmatter = Frontmatter.fromMeta(data.frontmatter as MetaPanelData);
    if (data.originalFrontmatter) page.originalFrontmatter = Frontmatter.fromMeta(data.originalFrontmatter as MetaPanelData);
    return page;
  }

  async flushIn(): Promise<boolean> {
    const provider = getProvider();
    try {
      const content = await provider.readFile(this.path);
      if (content == null) return false;

      const { frontmatter, body } = stripFrontmatter(content);
      this.setBaseline(body);
      this.frontmatter = frontmatter ? Frontmatter.fromMeta(frontmatter) : undefined;
      this.originalFrontmatter = this.frontmatter;
      const time = await provider.getServerTime(this.path);
      if (time != null) this.meta.serverTime = time;
      return true;
    } catch {
      return false;
    }
  }

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
      this.setBaseline(body);
      this.originalFrontmatter = this.frontmatter;
      this.bodyState.cacheBody(body);
      const fileTime = await provider.getServerTime(this.path);
      if (fileTime) this.setServerTime(fileTime);
      return true;
    } catch {
      return false;
    }
  }
}
