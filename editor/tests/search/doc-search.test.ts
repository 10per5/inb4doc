import { describe, expect, test } from "bun:test"
import type { Node as PMNode } from "prosemirror-model"
import { parse } from "../helpers/markdown"
import {
  findDocMatches,
  findHeadingRange,
  pickDocMatch,
} from "@/features/search/doc-search"

describe("findDocMatches", () => {
  test("reports positions, blocks and heading trails", () => {
    const doc = parse(
      [
        "# Guide",
        "",
        "Alpha first.",
        "",
        "## Setup",
        "",
        "Alpha second.",
      ].join("\n"),
    )

    const matches = findDocMatches(doc, "Alpha")
    expect(matches).toHaveLength(2)

    expect(matches[0].blockText).toBe("Alpha first.")
    expect(matches[0].headingPath).toEqual(["Guide"])
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe("Alpha")

    expect(matches[1].blockText).toBe("Alpha second.")
    expect(matches[1].headingPath).toEqual(["Guide", "Setup"])
  })

  test("finds text inside marks and nested blocks", () => {
    const doc = parse("Run **bold** and `code` now.")
    const bold = findDocMatches(doc, "bold")
    const code = findDocMatches(doc, "code")

    expect(bold).toHaveLength(1)
    expect(code).toHaveLength(1)
    expect(doc.textBetween(bold[0].from, bold[0].to)).toBe("bold")
    expect(bold[0].blockText).toContain("Run bold and")
  })

  test("reports the nearest text block inside a table cell", () => {
    const doc = parse(["| A | B |", "| --- | --- |", "| x | y |"].join("\n"))
    const matches = findDocMatches(doc, "y")
    expect(matches).toHaveLength(1)
    expect(matches[0].blockText).toBe("y")
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe("y")
  })

  test("returns nothing for an empty query", () => {
    const doc = parse("Alpha")
    expect(findDocMatches(doc, "   ")).toEqual([])
  })
})

describe("pickDocMatch", () => {
  const doc: PMNode = parse(
    ["# A", "", "Alpha one.", "", "## B", "", "Alpha two."].join("\n"),
  )
  const matches = findDocMatches(doc, "Alpha")

  test("prefers the clicked block over the global index", () => {
    const picked = pickDocMatch(matches, { blockText: "Alpha two." })
    expect(picked?.blockText).toBe("Alpha two.")
  })

  test("matches a hit whose display text drops markup", () => {
    const nested = findDocMatches(parse("Alpha **bold** tail."), "bold")
    const picked = pickDocMatch(nested, { blockText: "Alpha bold tail." })
    expect(picked?.blockText).toBe("Alpha bold tail.")
  })

  test("prefers the hit's own section over an identical block elsewhere", () => {
    const doc = parse(
      ["# A", "", "Alpha one.", "", "## B", "", "Alpha one."].join("\n"),
    )
    const matches = findDocMatches(doc, "Alpha")
    const picked = pickDocMatch(matches, {
      blockText: "Alpha one.",
      headingPath: ["A", "B"],
    })
    expect(picked?.headingPath).toEqual(["A", "B"])
  })

  test("falls back to the global occurrence", () => {
    expect(pickDocMatch(matches, { matchIndex: 1 })?.blockText).toBe("Alpha two.")
    expect(pickDocMatch(matches, { matchIndex: 99 })?.blockText).toBe("Alpha one.")
  })
})

describe("findHeadingRange", () => {
  test("finds a heading by level and text", () => {
    const doc = parse("# Guide\n\n## Setup\n\nBody.")
    const range = findHeadingRange(doc, "Setup", 2)
    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe("Setup")
  })

  test("does not match a heading at another level", () => {
    const doc = parse("# Setup\n\nBody.")
    expect(findHeadingRange(doc, "Setup", 2)).toBeNull()
  })
})
