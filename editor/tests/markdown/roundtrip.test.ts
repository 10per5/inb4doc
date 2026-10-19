import { describe, expect, test } from "bun:test";
import { MARKDOWN_FIXTURES } from "../fixtures/markdown";
import { parse, roundtrip, schema } from "../helpers/markdown";

/**
 * The core regression net for the markdown layer.
 *
 * `roundtrip(md)` = `serialize(parse(md))`, i.e. one load/save pass. For the
 * editor to be lossless across "load → edit → save → reload", that pass must be
 * a fixed point (`roundtrip(roundtrip(md)) === roundtrip(md)`) and must not
 * change the document's text content.
 */

describe("markdown round-trip — stability (fixed point after one pass)", () => {
  for (const [name, md] of Object.entries(MARKDOWN_FIXTURES)) {
    test(`"${name}"`, () => {
      const once = roundtrip(md);
      expect(roundtrip(once)).toBe(once);
    });
  }
});

describe("markdown round-trip — text fidelity (no characters lost)", () => {
  for (const [name, md] of Object.entries(MARKDOWN_FIXTURES)) {
    test(`"${name}"`, () => {
      const before = parse(md).textContent;
      const after = parse(roundtrip(md)).textContent;
      expect(after).toBe(before);
    });
  }
});

describe("markdown round-trip — regressions", () => {
  test("bold wrapping inline code serializes as **`code`** (mark order)", () => {
    // The serializer treats a non-escaping mark (`code`) as the innermost mark
    // only when it is LAST in `node.marks`, i.e. when it has the highest schema
    // rank. If `code`'s rank drops below `bold`, this regresses to the literal
    // text `` `**code**` `` and both the bold mark and the code span are lost.
    // Found via the real page docs/ssg/endpoints.md.
    const md = "**`GET /content/<path>`** — Read a file.";
    expect(roundtrip(md)).toBe("**`GET /content/<path>`** — Read a file.");
  });

  test("the `code` mark has the highest rank so it nests innermost", () => {
    // `rank` is an internal ProseMirror field; it is what `Mark.setFrom` sorts
    // by, so it is exactly what we need to assert here.
    const rankOf = (name: string): number =>
      (schema.marks[name] as unknown as { rank: number }).rank;
    const codeRank = rankOf("code");
    for (const name of Object.keys(schema.marks)) {
      if (name === "code") continue;
      expect(codeRank).toBeGreaterThan(rankOf(name));
    }
  });

  test("inline code containing a backtick keeps the backtick", () => {
    // A longer fence is required (``a`b``). The exact output adds a space on
    // each side of the widened fence — that is prosemirror-markdown's canonical
    // form and it still parses to the code span `a`b`.
    const md = "Use `foo()` and ``a`b`` here.";
    expect(roundtrip(md)).toBe("Use `foo()` and `` a`b `` here.");
    expect(parse(roundtrip(md)).textContent).toBe(parse(md).textContent);
  });

  test("a loose list item with a continued paragraph is a fixed point", () => {
    const md = MARKDOWN_FIXTURES.looseListWithParagraphs;
    const once = roundtrip(md);
    expect(roundtrip(once)).toBe(once);
    // The continued paragraph must stay inside the item (indented), not split
    // off into its own sibling item.
    expect(once).toContain("\n  continued paragraph");
  });

  test("ordered lists keep each item's number, including a non-1 start", () => {
    // Each `list` node is a single item, so the parser must store the item's
    // own number or every marker degrades to "1.".
    const sequential = roundtrip("1. one\n2. two\n3. three\n");
    expect(sequential).toContain("1. one");
    expect(sequential).toContain("2. two");
    expect(sequential).toContain("3. three");

    const fromFive = roundtrip("5. five\n6. six\n7. seven\n");
    expect(fromFive).toContain("5. five");
    expect(fromFive).toContain("6. six");
    expect(fromFive).toContain("7. seven");
  });
});
