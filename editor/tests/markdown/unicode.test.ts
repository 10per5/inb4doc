import { describe, expect, test } from "bun:test";
import { UNICODE_FIXTURES } from "../fixtures/markdown";
import { parse, roundtrip } from "../helpers/markdown";

/**
 * Complex glyph / unicode / spacing preservation.
 *
 * Markdown serializers can silently mangle multi-byte text (escaping, byte
 * splitting, entity encoding). These tests assert that the *exact* character
 * sequence survives a load/save pass, not merely that the bytes are "equivalent".
 */

describe("unicode — exact character preservation", () => {
  for (const [name, md] of Object.entries(UNICODE_FIXTURES)) {
    test(`"${name}" text is byte-for-byte identical after a normalize pass`, () => {
      const before = parse(md).textContent;
      const after = parse(roundtrip(md)).textContent;
      expect(after).toBe(before);
    });

    test(`"${name}" is a fixed point`, () => {
      const once = roundtrip(md);
      expect(roundtrip(once)).toBe(once);
    });
  }
});

describe("unicode — structured content around glyphs", () => {
  test("emoji inside a list item survives", () => {
    const md = "- 🎉 party\n- 👨‍👩‍👧‍👦 family";
    expect(parse(roundtrip(md)).textContent).toBe("🎉 party👨‍👩‍👧‍👦 family");
  });

  test("CJK inside a table cell survives", () => {
    const md = ["| 名前 | 説明 |", "| --- | --- |", "| 日本語 | 中文 |"].join("\n");
    expect(parse(roundtrip(md)).textContent).toBe("名前説明日本語中文");
  });

  test("unicode inside a heading survives", () => {
    const md = "## Ελληνικά — заголовок";
    expect(parse(roundtrip(md)).textContent).toBe("Ελληνικά — заголовок");
  });

  test("unicode inside a code block is preserved verbatim", () => {
    const md = ["```", "const café = '☕'; // 日本語", "```"].join("\n");
    expect(parse(roundtrip(md)).textContent).toBe("const café = '☕'; // 日本語");
  });
});
