import { describe, expect, test } from "bun:test";
import { merge3 } from "@/utils/merge3";

/**
 * `merge3` drives per-section formatting: `ours` is the raw on-disk baseline,
 * `base` (C0) is the canonical serialization of that baseline, and `theirs` is
 * the canonical serialization after the user's edits. Regions the user did not
 * touch keep their raw formatting; edits come out canonical.
 *
 * These cases mirror the real call shape, including the empty-block change
 * (a trailing `<br />` appended to a body whose canonical form has no trailing
 * newline).
 */

type Case = {
  name: string;
  ours: string;
  base: string;
  theirs: string;
  want: string;
};

// Only `.merged` is consumed by callers (editor-controller, dirty-tracking and
// file-sync all read `.merged`); `conflicts` is informational, so these cases
// assert the merged output only.
const cases: Case[] = [
  {
    name: "no-op",
    ours: "a\n",
    base: "a\n",
    theirs: "a\n",
    want: "a\n",
  },
  {
    name: "trailing append (ours === base)",
    ours: "a\n",
    base: "a\n",
    theirs: "a\n\nb\n",
    want: "a\n\nb\n",
  },
  {
    name: "middle insert (ours === base)",
    ours: "a\nb\n",
    base: "a\nb\n",
    theirs: "a\nx\nb\n",
    want: "a\nx\nb\n",
  },
  {
    name: "in-place edit (ours === base, raw formatting preserved)",
    ours: "* a\n* b\n",
    base: "* a\n* b\n",
    theirs: "* a\n* c\n",
    want: "* a\n* c\n",
  },
  {
    name: "normalization only (untouched region keeps raw formatting)",
    ours: "* a\n",
    base: "- a\n",
    theirs: "- a\n",
    want: "* a\n",
  },
  {
    // Note: this overlap counts a conflict (ours' trailing newline vs theirs'
    // appended block), but the merged body is still correct.
    name: "trailing empty block appended (newline is a real change)",
    ours: "a\n",
    base: "a",
    theirs: "a\n\n<br />",
    want: "a\n\n<br />",
  },
  {
    name: "trailing empty block appended after raw formatting",
    ours: "* a\n",
    base: "- a\n",
    theirs: "- a\n\n<br />",
    want: "* a\n\n<br />",
  },
  {
    name: "diff3: insertion in ours, edit in theirs, disjoint regions",
    ours: "a\nX\nb\nc\n",
    base: "a\nb\nc\n",
    theirs: "a\nb\nc\nY\n",
    want: "a\nX\nb\nc\nY\n",
  },
  {
    name: "CRLF input is normalized to LF",
    ours: "a\r\nb\r\n",
    base: "a\nb\n",
    theirs: "a\nB\n",
    want: "a\nB\n",
  },
];

describe("merge3 — merge results", () => {
  for (const c of cases) {
    test(c.name, () => {
      expect(merge3(c.ours, c.base, c.theirs).merged).toBe(c.want);
    });
  }
});

describe("merge3 — conflicts", () => {
  test("both sides edit the same region differently → conflict, theirs wins", () => {
    const result = merge3("a\nours\nc\n", "a\nbase\nc\n", "a\ntheirs\nc\n");
    expect(result.merged).toBe("a\ntheirs\nc\n");
    expect(result.conflicts).toBe(1);
  });

  test("both sides make the same edit → no conflict", () => {
    const result = merge3("a\nx\nc\n", "a\nbase\nc\n", "a\nx\nc\n");
    expect(result.merged).toBe("a\nx\nc\n");
    expect(result.conflicts).toBe(0);
  });
});

describe("merge3 — large-document fallback", () => {
  test("beyond the DP cap it writes the canonical `theirs` unchanged", () => {
    // 3000 × 3000 = 9,000,000 cells > MAX_DP_CELLS (4,000,000).
    const lines = (label: string) =>
      Array.from({ length: 3000 }, (_, i) => `${label} ${i}`).join("\n");
    const ours = `${lines("ours")}\n`;
    const base = `${lines("base")}\n`;
    const theirs = `${lines("theirs")}\n`;

    const result = merge3(ours, base, theirs);
    expect(result.merged).toBe(theirs);
    expect(result.conflicts).toBe(0);
  });
});
