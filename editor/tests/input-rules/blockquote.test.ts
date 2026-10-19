import { describe, expect, test } from "bun:test";
import { BLOCKQUOTE_INPUT_RULE } from "@/config/blockquote-input-rule";

/**
 * prosemirror-inputrules matches an input rule against the last MAX_MATCH
 * characters before the caret (see its `run()`), with the typed text appended.
 * `textBefore` below reproduces that window so these cases exercise the real
 * regex the app installs, not a paraphrase of it.
 */
const MAX_MATCH = 500;

function windowAt(text: string, caret: number): string {
  return text.slice(Math.max(0, caret - MAX_MATCH), caret);
}

// The author's bug report, verbatim: a `>` typed mid-paragraph.
const PARAGRAPH =
  "Preferences window creates the ideal UI window system for our entire app for any mini windows that need to be opened (not dialogs). I.e, when gonig from Preferences > Storage panel, to \"change\" storage backend button, it should hav essentially the same UI elements, but with our improved preference window ui window dimensions/format. Then when cancel is rpessed, it should be aware to go back to the preferences view that the user was just in. For that we need a manager/service for Ui windows, and that is rpecisely why I want to make sure that windows are managed and centrally controlled. When clicking accept as well, but if the window is opened independently by someone else.";

describe("blockquote input rule", () => {
  test("fires from the start of a block", () => {
    const before = windowAt("> ", 1) + " ";
    expect(BLOCKQUOTE_INPUT_RULE.test(before)).toBe(true);
  });

  test("never fires on a `>` typed mid-paragraph", () => {
    // Upstream's rule (`/^>\s/`, no `$`) matches here: 500 characters after the
    // `>`, the sliding window starts exactly at it, so the caret sees "> …".
    const upstream = /^>\s/;
    const caret = PARAGRAPH.indexOf(">") + MAX_MATCH;
    expect(upstream.test(windowAt(PARAGRAPH, caret) + " ")).toBe(true);

    for (let i = 1; i <= PARAGRAPH.length; i++) {
      const before = windowAt(PARAGRAPH, i) + PARAGRAPH[i - 1];
      expect(BLOCKQUOTE_INPUT_RULE.test(before)).toBe(false);
    }
  });

  test("is anchored at both ends", () => {
    // No `$` would match "> anything"; no `^` would match "x> ".
    expect(BLOCKQUOTE_INPUT_RULE.test("> Storage panel, to \"change\"…")).toBe(false);
    expect(BLOCKQUOTE_INPUT_RULE.test("Preferences > ")).toBe(false);
  });
});
