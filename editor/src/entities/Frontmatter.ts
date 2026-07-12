import { parseFrontmatter, serializeFrontmatter } from "@/utils/frontmatter";
import type { MetaPanelData } from "@/components/panels/meta-panel";

/**
 * Page frontmatter as a value object.
 *
 * Parsing/serializing currently delegates to `utils/frontmatter`, but the
 * read/write accessors live here so callers never touch the raw `MetaPanelData`
 * shape. Frontmatter has no lifecycle independent of its `Page`, so it is a
 * value object owned by the page — not a separate store.
 */
export class Frontmatter {
  constructor(private data: MetaPanelData) {}

  get title(): string {
    return this.data.title;
  }

  get weight(): number | undefined {
    return this.data.weight;
  }

  get(key: string): string | number | undefined {
    return this.data[key];
  }

  set(key: string, value: string | number | undefined): void {
    if (value === undefined) delete this.data[key];
    else this.data[key] = value;
  }

  toMeta(): MetaPanelData {
    return { ...this.data };
  }

  serialize(): string {
    return serializeFrontmatter(this.data);
  }

  static fromMeta(meta: MetaPanelData): Frontmatter {
    return new Frontmatter({ ...meta });
  }

  static parse(raw: string): Frontmatter {
    return new Frontmatter(parseFrontmatter(raw));
  }
}
