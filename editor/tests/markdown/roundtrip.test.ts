import { describe, expect, test } from "bun:test";
import {
  KNOWN_UNSTABLE_FIXTURES,
  MARKDOWN_FIXTURES,
} from "../fixtures/markdown";
import { parse, roundtrip } from "../helpers/markdown";

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

describe("markdown round-trip — known limitations", () => {
  test("loose list with a continued paragraph preserves text (formatting churns)", () => {
    const { md } = KNOWN_UNSTABLE_FIXTURES.looseListWithParagraphs;
    expect(parse(roundtrip(md)).textContent).toBe(parse(md).textContent);
  });

  test("bold wrapping inline code keeps the bold markers", () => {
    // Regression pin: `**\`code\`**` currently serializes to `` `**code**` ``,
    // which loses the bold mark and makes the `**` literal text. Found via the
    // real page docs/ssg/endpoints.md.
    const md = "**`GET /content/<path>`** — Read a file.";
    expect(roundtrip(md)).toBe("`**GET /content/<path>**` — Read a file.");
  });

  test.todo(
    "loose list with a continued paragraph should be a fixed point (extra blank line today)",
    () => {},
  );
  test.todo(
    "inline code containing a backtick should round-trip losslessly (backtick lost today)",
    () => {},
  );
  test.todo(
    "bold wrapping inline code should serialize as **`code`** and round-trip losslessly",
    () => {},
  );
});
