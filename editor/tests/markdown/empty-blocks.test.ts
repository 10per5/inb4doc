import { describe, expect, test } from "bun:test";
import {
  doc,
  normalizeMarkdown,
  paragraph,
  parse,
  roundtrip,
  serialize,
} from "../helpers/markdown";

/**
 * Empty blocks and trailing newlines.
 *
 * An empty paragraph is serialized as an explicit `<br />` line whenever it is
 * not the sole block in the document. This is what makes "Enter at the end of
 * the document" a real body change (so the file registers dirty and the blank
 * line survives a reload), while a file that is genuinely empty still
 * round-trips to an empty string.
 *
 * The `<br />` form is chosen because it parses back into an empty paragraph,
 * so the blank line is preserved on reload.
 */

const emptyParagraphCount = (md: string): number => {
  let count = 0;
  parse(md).forEach((node) => {
    if (node.type.name === "paragraph" && node.content.size === 0) count += 1;
  });
  return count;
};

describe("empty paragraph serialization", () => {
  test("a document that is a single empty paragraph serializes to empty string", () => {
    expect(serialize(doc(paragraph("")))).toBe("");
  });

  test("a trailing empty paragraph becomes <br />", () => {
    expect(serialize(doc(paragraph("a"), paragraph("")))).toBe("a\n\n<br />");
  });

  test("multiple trailing empty paragraphs each become <br />", () => {
    expect(serialize(doc(paragraph("a"), paragraph(""), paragraph("")))).toBe(
      "a\n\n<br />\n\n<br />",
    );
  });

  test("an interior empty paragraph becomes <br />", () => {
    expect(serialize(doc(paragraph("a"), paragraph(""), paragraph("b")))).toBe(
      "a\n\n<br />\n\nb",
    );
  });

  test("a leading empty paragraph becomes <br />", () => {
    expect(serialize(doc(paragraph(""), paragraph("a")))).toBe("<br />\n\na");
  });

  test("a document of only empty paragraphs is not collapsed", () => {
    expect(serialize(doc(paragraph(""), paragraph("")))).toBe(
      "<br />\n\n<br />",
    );
  });
});

describe("<br /> round-trips back to an empty paragraph", () => {
  const cases: Array<[string, string, number]> = [
    ["trailing", "a\n\n<br />", 1],
    ["interior", "a\n\n<br />\n\nb", 1],
    ["leading", "<br />\n\na", 1],
    ["several", "a\n\n<br />\n\n<br />\n\nb", 2],
  ];

  for (const [label, md, empties] of cases) {
    test(`${label}: preserves ${empties} empty paragraph(s)`, () => {
      expect(emptyParagraphCount(md)).toBe(empties);
    });

    test(`${label}: is a fixed point`, () => {
      expect(roundtrip(md)).toBe(md);
      expect(roundtrip(roundtrip(md))).toBe(md);
    });
  }
});

describe("save normalization", () => {
  test("collapses runs of trailing newlines to a single newline", () => {
    expect(normalizeMarkdown("body\n\n\n")).toBe("body\n");
  });

  test("leaves a body with no trailing newline untouched", () => {
    expect(normalizeMarkdown("body")).toBe("body");
  });

  test("normalizes CRLF to LF", () => {
    expect(normalizeMarkdown("a\r\nb\r\n")).toBe("a\nb\n");
  });
});
