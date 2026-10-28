import { describe, expect, test } from "bun:test";
import { ancestorDirs } from "@/utils/tree";

/**
 * The explorer renders collapsed apart from the chain of folders leading to the
 * open document, so the chain has to be derived for every shape of path the
 * app navigates to: nested pages, root pages, and a directory's own `_index`
 * page (which must open down to its own folder, not one level short).
 */
describe("ancestorDirs", () => {
  test("returns every folder above a nested page", () => {
    expect(ancestorDirs("docs/guide/intro.md")).toEqual(["docs", "docs/guide"]);
  });

  test("has no ancestors for a root-level page", () => {
    expect(ancestorDirs("_index.md")).toEqual([]);
    expect(ancestorDirs("readme.md")).toEqual([]);
  });

  test("includes the folder itself for an index page", () => {
    expect(ancestorDirs("docs/guide/_index.md")).toEqual([
      "docs",
      "docs/guide",
    ]);
    expect(ancestorDirs("docs/_index")).toEqual(["docs"]);
  });

  test("ignores trailing slashes and empty segments", () => {
    expect(ancestorDirs("docs/guide/")).toEqual(["docs"]);
    expect(ancestorDirs("/docs/guide/page.md")).toEqual(["docs", "docs/guide"]);
    expect(ancestorDirs("")).toEqual([]);
  });
});
