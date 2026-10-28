import { describe, expect, test } from "bun:test";
import {
  hasContentBeyondTitle,
  isPathInScope,
} from "@/features/project-entry";

describe("project-entry — scope containment", () => {
  test("an empty scope contains everything", () => {
    expect(isPathInScope("docs/guide", "")).toBe(true);
    expect(isPathInScope("_index", "")).toBe(true);
  });

  test("a scope contains itself and everything under it", () => {
    expect(isPathInScope("docs", "docs")).toBe(true);
    expect(isPathInScope("docs/guide", "docs")).toBe(true);
  });

  test("a sibling folder sharing a prefix is NOT inside the scope", () => {
    // Naive `startsWith` would match "docs" in "docs-old/intro".
    expect(isPathInScope("docs-old/intro", "docs")).toBe(false);
  });
});

describe("project-entry — title-only stubs", () => {
  test("a bare `# thisthat` heading has no content", () => {
    expect(hasContentBeyondTitle("# thisthat")).toBe(false);
  });

  test("frontmatter plus a heading is still just a title block", () => {
    expect(
      hasContentBeyondTitle("---\ntitle: Home\nweight: 1\n---\n\n# thisthat\n"),
    ).toBe(false);
  });

  test("empty and missing content have no content", () => {
    expect(hasContentBeyondTitle("")).toBe(false);
    expect(hasContentBeyondTitle(null)).toBe(false);
  });

  test("anything past the title block counts as content", () => {
    expect(hasContentBeyondTitle("# Title\n\nSome prose.")).toBe(true);
    expect(hasContentBeyondTitle("# Title\n- a list")).toBe(true);
  });

  test("a later heading inside real content is content, not a title", () => {
    expect(hasContentBeyondTitle("Intro text.\n\n# Later heading")).toBe(true);
  });
});
