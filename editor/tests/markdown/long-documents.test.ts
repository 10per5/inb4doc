import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { MARKDOWN_FIXTURES, stripFrontmatter } from "../fixtures/markdown";
import { doc, paragraph, parse, roundtrip, serialize } from "../helpers/markdown";

/**
 * Long-document regression tests.
 *
 * The serializer change under test (empty blocks → `<br />`) is most likely to
 * regress the *tail* of a real document, where many blocks and blank lines
 * accumulate. These tests build long documents and also replay the real pages
 * under `content/` when that directory is available.
 */

describe("synthesized long documents", () => {
  test("a document built from repeated mixed content stays a fixed point", () => {
    const chunk = MARKDOWN_FIXTURES.mixedLong;
    const md = Array.from(
      { length: 25 },
      (_, i) => `# Section ${i}\n\n${chunk}`,
    ).join("\n\n");

    const once = roundtrip(md);
    expect(roundtrip(once)).toBe(once);
    expect(parse(once).textContent).toBe(parse(md).textContent);
    // Sanity: the tail of the document is still present.
    expect(parse(once).textContent).toContain("End paragraph.");
  });

  test("many interleaved empty blocks are all preserved and stable", () => {
    const count = 40;
    const blocks = [];
    for (let i = 0; i < count; i++) {
      blocks.push(paragraph(`paragraph ${i}`));
      blocks.push(paragraph(""));
    }

    const md = serialize(doc(...blocks));
    const once = roundtrip(md);

    expect(roundtrip(once)).toBe(once);

    const reparsed = parse(md);
    let empties = 0;
    reparsed.forEach((node) => {
      if (node.type.name === "paragraph" && node.content.size === 0) empties += 1;
    });

    expect(empties).toBe(count);
    expect(reparsed.childCount).toBe(count * 2);
  });

  test("a large table survives intact", () => {
    const header = `| a | b | c |\n| --- | --- | --- |`;
    const rows = Array.from(
      { length: 200 },
      (_, i) => `| ${i} | value ${i} | ${i * 2} |`,
    ).join("\n");
    const md = `${header}\n${rows}`;

    const once = roundtrip(md);
    expect(roundtrip(once)).toBe(once);
    expect(parse(once).textContent).toBe(parse(md).textContent);
  });
});

// --- real content pages -----------------------------------------------------

const contentRoot = join(import.meta.dir, "../../../content");

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const contentFiles = existsSync(contentRoot)
  ? collectMarkdownFiles(contentRoot)
  : [];

/**
 * Real pages whose text does not survive a single normalize pass today, with
 * the reason. They are still asserted to be a fixed point (the corruption does
 * not accumulate), but the first-pass loss is tracked as a `todo` rather than
 * a hard failure. Remove an entry once its loss is fixed.
 */
const KNOWN_LOSSY_PAGES: Record<string, string> = {
  "docs/ssg/endpoints.md":
    "contains `**`code`**` (bold wrapping inline code); the serializer emits the code span outermost, turning the `**` into literal text",
};

describe("real content pages", () => {
  if (contentFiles.length === 0) {
    test.todo(`no markdown pages found under ${contentRoot}`, () => {});
    return;
  }

  for (const file of contentFiles) {
    const label = relative(contentRoot, file);

    test(`"${label}" is a fixed point`, () => {
      const body = stripFrontmatter(readFileSync(file, "utf8"));
      const once = roundtrip(body);
      expect(roundtrip(once)).toBe(once);
    });

    if (label in KNOWN_LOSSY_PAGES) {
      test.todo(
        `"${label}" loses no text — ${KNOWN_LOSSY_PAGES[label]}`,
        () => {},
      );
    } else {
      test(`"${label}" loses no text`, () => {
        const body = stripFrontmatter(readFileSync(file, "utf8"));
        expect(parse(roundtrip(body)).textContent).toBe(parse(body).textContent);
      });
    }
  }
});
