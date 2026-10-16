/**
 * Markdown fixtures used by the round-trip regression suite.
 *
 * Each entry is real (or realistically shaped) markdown. The suite asserts two
 * invariants for every fixture:
 *
 *   1. Stability  — serialize(parse(md)) is a fixed point: running it again
 *                   yields the same bytes. This is what makes "load file,
 *                   edit, save, reload, save" lossless.
 *   2. Text fidelity — the concatenated text content of the document is
 *                   unchanged by a normalize pass. No characters are dropped.
 *
 * Add new block/inline types here as the schema grows; the suites pick them up
 * automatically. Keep each fixture stable (see the round-trip test) — if a new
 * fixture legitimately cannot be stable, give it a dedicated test instead of
 * adding it here.
 */

export const MARKDOWN_FIXTURES: Record<string, string> = {
  // --- Paragraphs & headings ---
  paragraphs: [
    "First paragraph.",
    "",
    "Second paragraph with **bold**, *italic*, ~~strike~~ and `code`.",
  ].join("\n"),

  headings: [
    "# Heading one",
    "",
    "## Heading two",
    "",
    "### Heading three",
    "",
    "#### Heading four",
    "",
    "##### Heading five",
    "",
    "###### Heading six",
  ].join("\n"),

  // --- Lists ---
  bulletList: ["- one", "- two", "- three"].join("\n"),

  orderedList: ["1. first", "2. second", "3. third"].join("\n"),

  orderedListStartAtFive: ["5. five", "6. six", "7. seven"].join("\n"),

  nestedList: ["- a", "  - a1", "  - a2", "- b", "  - b1"].join("\n"),

  taskList: ["- [ ] todo", "- [x] done", "- [ ] another task"].join("\n"),

  taskListWithMarks: [
    "- [ ] **bold** task with `code`",
    "- [x] done with [a link](https://example.com)",
  ].join("\n"),

  // A "loose" list item that contains a continued paragraph. The continued
  // block must be indented under the same item, otherwise it re-parses as a
  // new sibling item and the document churns on every save.
  looseListWithParagraphs: [
    "- first item",
    "",
    "  continued paragraph",
    "",
    "- second item",
  ].join("\n"),

  // --- Quotes & alerts ---
  blockquote: ["> quoted line", ">", "> second paragraph in quote"].join("\n"),

  nestedBlockquote: ["> outer", ">", "> > inner quote"].join("\n"),

  alertNote: ["> [!NOTE]", "> A note."].join("\n"),
  alertTip: ["> [!TIP]", "> A tip with **bold**."].join("\n"),
  alertImportant: ["> [!IMPORTANT]", "> Important."].join("\n"),
  alertWarning: ["> [!WARNING]", "> Careful now."].join("\n"),
  alertCaution: ["> [!CAUTION]", "> Caution."].join("\n"),
  alertInfo: ["> [!INFO]", "> Info."].join("\n"),
  alertSuccess: ["> [!SUCCESS]", "> Success."].join("\n"),
  alertDanger: ["> [!DANGER]", "> Danger."].join("\n"),

  // --- Code ---
  codeBlockJs: [
    "```js",
    "const x = 1 < 2 && 3 > 2;",
    "console.log(`value: ${x}`);",
    "```",
  ].join("\n"),

  codeBlockNoLanguage: ["```", "plain text", "  indented", "```"].join("\n"),

  codeBlockWithBackticks: [
    "````md",
    "```",
    "nested fence",
    "```",
    "````",
  ].join("\n"),

  // --- Code (inline) ---
  inlineCode: "Use `foo()` here.",

  // A code span whose content itself contains a backtick needs a longer
  // delimiter (``…``). The serializer must widen the fence rather than emit a
  // single backtick that would terminate the span early and drop the backtick.
  inlineCodeWithBacktick: "Use `foo()` and ``a`b`` here.",

  inlineCodeWithMarks:
    "Some **`GET /content/<path>`** and *`x`* and ~~`y`~~ inline.",

  // --- Rules, breaks ---
  horizontalRule: ["above", "", "---", "", "below"].join("\n"),

  hardBreak: ["line one\\", "line two"].join("\n"),

  // --- Tables ---
  table: ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n"),

  tableAlignment: [
    "| Left | Center | Right |",
    "| :--- | :----: | ----: |",
    "| a | b | c |",
    "| d | e | f |",
  ].join("\n"),

  tableInlineFormatting: [
    "| Feature | Notes |",
    "| --- | --- |",
    "| **bold** | `code` |",
    "| [link](https://example.com) | *italic* |",
  ].join("\n"),

  // --- Images & links ---
  image: "![alt text](https://example.com/a.png)",

  imageWithTitle: '![alt text](https://example.com/a.png "A title")',

  link: "A [link](https://example.com) inline.",

  linkWithTitle: 'A [titled link](https://example.com "Example") inline.',

  autolink: "<https://example.com>",

  referenceStyleImageBlock:
    '![1.50;w=100;h=50](https://example.com/a.png "A caption")',

  // --- Dynamic / Hugo-specific blocks ---
  divCenter: ['<div align="center">', "", "centered text", "", "</div>"].join(
    "\n",
  ),

  hugoRef: 'A ref [Roadmap](<{{% ref path="/docs/roadmap" %}}>) inline.',

  video: '<video controls src="https://example.com/v.mp4"></video>',

  mathBlock: ["$$", "E = mc^2", "$$"].join("\n"),

  mathInline: "Inline $a^2 + b^2 = c^2$ math.",

  // --- Spacing & indentation ---
  multipleSpaces: "a   b      c",

  blankLinesBetweenParagraphs: "para one\n\n\n\npara two",

  tabIndentedCode: "\tif (x) {\n\t\treturn 1;\n\t}",

  codeWithTrailingSpaces: "```\nline with trailing   \nnext\n```",

  deepNestedList: "- a\n    - b\n        - c",

  paddedTable: ["|  A  |   B   |", "| --- | ----- |", "|  1  |   2   |"].join(
    "\n",
  ),

  // --- Mixed realistic long document ---
  mixedLong: [
    "# Title",
    "",
    "Intro paragraph with **bold** and `code`.",
    "",
    "## Section",
    "",
    "- item one",
    "- item two",
    "  - nested item",
    "",
    "1. first",
    "2. second",
    "",
    "> A quote",
    "",
    "```py",
    "print('hi')",
    "```",
    "",
    "| x | y |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "- [ ] a task",
    "",
    "End paragraph.",
  ].join("\n"),
};

/**
 * Unicode / glyph / spacing fixtures. These stress exact character
 * preservation through the markdown round-trip: multi-byte scripts, combining
 * marks, zero-width and non-breaking characters, astral-plane characters, and
 * smart punctuation. See `tests/markdown/unicode.test.ts`.
 */
export const UNICODE_FIXTURES: Record<string, string> = {
  latinAccents: "Café, naïve, résumé, Zürich, piñata, smörgåsbord.",
  combiningMarks: "e\u0301 a\u0300 o\u0308 n\u0303 (combining diacritics)",
  cjk: "日本語のテキスト。中文文本。한국어 텍스트.",
  arabicHebrew: "العربية مرحبا. עברית שלום.",
  cyrillicGreek: "Привет мир. Ελληνικά κείμενο.",
  devanagari: "नमस्ते दुनिया",
  emoji: "Party 🎉 family 👨‍👩‍👧‍👦 flag 🇯🇵 tone 👍🏽",
  mathSymbols: "∑ ∫ ∞ ≈ ≠ ≤ ≥ √ π ± × ÷",
  arrows: "→ ← ↔ ⇒ ⇔ ↑ ↓",
  currency: "€ £ ¥ ₹ ₿ $",
  zeroWidthAndNbsp: "a\u200Bb\u200Dc\u00A0d",
  smartPunctuation: "“Curly” ‘quotes’ — em dash – en dash … ellipsis",
  astralPlane: "𝕬𝖇𝖈 𝓕𝓻𝓪𝓬𝓽𝓾𝓻 𝑥𝑦𝑧",
  subSuperScript: "H₂O and x² + y³",
  mixedParagraph: "Wait… Café ☕ costs €5 — really? 日本語 yeah! 🎉",
};

/**
 * Remove a leading YAML frontmatter block (`---` … `---`) from a page body.
 * The editor parses body-only content; frontmatter is handled separately.
 */
export function stripFrontmatter(md: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return match ? md.slice(match[0].length) : md;
}
