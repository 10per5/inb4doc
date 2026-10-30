import { describe, expect, test } from "bun:test"
import {
  extractHits,
  hitsFromSnippets,
  markdownToText,
} from "@/utils/content-search"

describe("markdownToText", () => {
  test("strips inline markers but keeps the words", () => {
    expect(markdownToText("Run `bun` **install** [now](https://x.y)")).toBe(
      "Run bun install now",
    )
  })

  test("drops list/checkbox/quote markers and raw html", () => {
    expect(markdownToText("- [x] done <span>here</span>")).toBe("done here")
    expect(markdownToText("> quoted")).toBe("quoted")
    expect(markdownToText("> [!NOTE] alert body")).toBe("alert body")
  })
})

describe("extractHits", () => {
  test("returns the heading trail for a matching paragraph", () => {
    const md = [
      "# Guide",
      "",
      "Intro.",
      "",
      "## Install",
      "",
      "Run `bun` install.",
    ].join("\n")

    const hits = extractHits(md, "bun")
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe("Run bun install.")
    expect(hits[0].headingPath).toEqual(["Guide", "Install"])
  })

  test("searches fenced code without leaking the fence", () => {
    const md = ["# Snippet", "", "```bash", "npm install foo", "```"].join("\n")
    const hits = extractHits(md, "npm")
    expect(hits[0].text).toBe("npm install foo")
    expect(hits[0].headingPath).toEqual(["Snippet"])
  })

  test("reports table rows as one hit with readable cells", () => {
    const md = [
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | 1 |",
    ].join("\n")

    const hits = extractHits(md, "alpha")
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe("alpha · 1")
  })

  test("one hit per list item", () => {
    const md = ["- alpha one", "- alpha two"].join("\n")
    const hits = extractHits(md, "alpha")
    expect(hits.map((h) => h.text)).toEqual(["alpha one", "alpha two"])
  })

  test("limits hits and ignores empty queries", () => {
    const md = "alpha\n\nbravo\n\nalpha\n\ncharlie\n\nalpha"
    expect(extractHits(md, "alpha", 2)).toHaveLength(2)
    expect(extractHits(md, "   ")).toEqual([])
  })

  test("keeps a file visible when only markdown syntax matches", () => {
    const md = "[label](https://example.com/hidden-target)"
    const hits = extractHits(md, "hidden-target")
    expect(hits).toHaveLength(1)
    // The visible text doesn't contain it, so the raw block is used as fallback.
    expect(hits[0].text).toContain("hidden-target")
  })
})

describe("hitsFromSnippets", () => {
  test("maps legacy snippets onto plain hits", () => {
    expect(hitsFromSnippets(["Run **bun** now"])).toEqual([
      { text: "Run bun now", headingPath: [] },
    ])
  })
})
