# Table Fixes Plan — Parser, Serializer, Tab Nav, Desktop Handles

Companion to the code-block work (`CODEBLOCK-NATIVE-PLAN.md`). Covers everything
table-related currently in flight. Written mid-debugging so the next session can
resume without re-deriving facts.

## Status overview

| # | Item | Status |
|---|------|--------|
| 1 | `<Tab>` / `<Shift-Tab>` dead inside tables | ✅ Fixed (`keyboard.ts`, tsc clean) |
| 2 | Markdown parser drops ALL text inside table cells | ✅ Not an app bug — repro schema was wrong; app parse is fine |
| 3 | Serializer emits blank lines inside tables → rows lost on reload | ✅ Fixed (`renderTable` single-block emission; corpus STABLE ×2) |
| 4 | Serializer drops headerless tables entirely (`if (!headerRow) return`) | ✅ Fixed (first row promoted to header; FALLBACK-OK probe) |
| 5 | Cell `alignment` attr parsed but not in ProseKit cell schema → lost | ✅ Fixed (`editor-schema.ts` cell overrides; `:---:` round-trips) |
| 6 | Desktop table-handle UI (`@prosekit/web/table-handle`) | ⏸ Approved direction, not started |
| 7 | Ctrl+X in a cell purged cell text but left an empty table shell | ✅ Fixed (deterministic clipboard write + `tr.delete`, no execCommand) |

**Post-fix note (item 2):** the "text vanishes" symptom was an artifact of the
headless repro schema missing `group: "inline"` on `text` — `createAndFill`
rejected every text-bearing paragraph and filled cells with empty paragraphs
(`fillBefore`). Traced via a `NodeType.createAndFill` probe. The app bridge's
parse path was correct all along; keep this gotcha in mind when building
minimal schemas in future repros.

Repro harness: `/tmp/opencode/table-parse.ts` (headless, run with
`bun /tmp/opencode/table-parse.ts` from `editor/`). It builds a minimal PM schema
mirroring ProseKit's table specs and drives the real
`src/config/editor-markdown.ts` bridge over a corpus of table shapes.

---

## 1. Tab navigation — DONE

Nobody ever bound Tab for tables: `@prosekit/extensions/table` = schema +
prosemirror-tables' `tableEditing()` + `columnResizing()` with zero keymap
bindings (verified by grep of their dist; also explains why prosekit.dev's own
demo doesn't do it). prosemirror-tables itself never binds Tab either.

Fix in `src/plugins/keyboard.ts`:

```ts
import { goToNextCell } from "prosemirror-tables"

"Tab": … if (isInsideTableCell($from)) return goToNextCell(1)(state, dispatch)
"Shift-Tab": … if (isInsideTableCell($from)) return goToNextCell(-1)(state, dispatch)
```

Both run BEFORE the code-block indent/list branches. This mirrors stock
ProseMirror example-setup behavior. Old comment claiming "the gfm table keymap"
would catch it was wrong — removed.

---

## 2+3+4. Parser / serializer bugs — ACTIVE

### Symptom (reproduced headlessly)

For input `"| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n"`:

- Parsed doc: correct `table > tableRow > tableHeaderCell/Cell > paragraph`
  tree, **every paragraph EMPTY**. Alignment attrs survive. Atom-ish inline
  nodes (`math_inline`) reportedly survive; plain text does not.
- Serialized output: `"|  |  |\n| --- | --- |\n\n\n|  |  |\n|  |  |"`
  — empty cells AND `\n\n\n` blank-line separation before body rows.
- Second round-trip: body rows gone entirely (blank line splits the GFM table;
  orphan pipe-lines stop being a table).

### Established mechanics (prosemirror-markdown@1.13.5)

- `MarkdownParseState.parseTokens` looks up handlers by FULL token type
  (`table_open`, `td_close`, …); unknown → throw.
- Token map specs expand: `block:` → `_open`/`_close` pair; `{ignore:true}` →
  noop pair; `noCloseToken` → single handler under bare name.
- `openNode` pushes `{type, attrs, content: [], marks: Mark.none}`.
- `addText(text)` appends `schema.text(text, top.marks)` into `top.content`.
- `addNode(type, attrs, content)` calls `type.createAndFill(attrs, content,
  top.marks)` and **silently returns null (drops subtree) if content doesn't fit**.
- `handlers.text` and `handlers.inline` (= `parseTokens(tok.children)`) are
  built-ins appended at the end of `tokenHandlers()`.
- Our bridge constructs the parser with all table tokens marked `{ignore:true}`,
  then patches the handler object post-construction (`Object.assign(handlers,
  {table_open…td_close})`). Structure/alignment prove these patched handlers DO
  run; the failure is downstream of them.

### Narrowed suspicion

`th_open`/`td_open` open CELL then PARAGRAPH frames; the cell's `inline` token
should hit built-in `handlers.inline` → `parseTokens(children)` → `handlers.text`
→ `addText` into the open paragraph. Structure arrives, text doesn't ⇒ either

a) the `inline` token's children never reach `text` (handler shadowing? token
   stream different than assumed?), or
b) `addText` runs but the paragraph frame's content is discarded at
   `closeNode`→`createAndFill` returning null — yet the EMPTY paragraph still
   appears in the doc, which contradicts a straight null-drop… unless the empty
   paragraph comes from somewhere else entirely.

### Next debug step (resume here)

Instrument `/tmp/opencode/table-parse.ts`: wrap `handlers.inline`,
`handlers.text`, `td_open/td_close` with loggers printing token types seen
between `td_open` and `td_close`. One run pinpoints (a) vs (b).
Fallback probe: `console.log(JSON.stringify(MarkdownIt().parse(md)))` to see the
raw token stream for a table.

### Fix sketch — parser (item 2)

Once pinpointed, prefer the least invasive patch consistent with the existing
pattern (patched handler object in `createMarkdownParser`). Candidate fixes:

- If `inline` children are mis-routed: bind cell content parsing explicitly in
  `td_open/th_open` (stash the upcoming `inline` token) or re-point
  `handlers.inline` behavior for cell context.
- If `createAndFill` drop: make cell content fit the real app schema (note my
  repro schema HAS an `alignment` attr the app lacks — re-run repro against a
  schema matching ProseKit's exactly: `colspan/rowspan/colwidth` ONLY, no
  alignment, before trusting any fix).
- Also verify `html:true` + taskLists plugins aren't rewriting the token stream
  inside cells.

### Fix sketch — serializer (items 3+4)

In `renderTable` (editor-markdown.ts ~L599):

```ts
const lines = [
  renderRow(headerRow),
  "| " + alignSep.join(" | ") + " |",
  ...bodyRows.map(renderRow),
]
state.write(lines.join("\n"))
state.closeBlock(node)
```

No interleaved `write`/`closeBlock` calls (each `closeBlock` defers a blank-line
flush consumed by the NEXT `write` — that's the `\n\n\n` source).

Headerless fallback (item 4): when no row contains `tableHeaderCell`, treat the
FIRST row as the header (GFM has no headerless form; dropping the table = silent
data loss — worst possible outcome given the content-invariant rules).

### Follow-up decision (item 5) — RESOLVED

ProseKit's `defineTableCellSpec`/`defineTableHeaderCellSpec` hardcode their
attrs (no options), so `editor-schema.ts` now carries full overrides mirroring
prosemirror-tables' `tableNodes()` output plus `alignment {default:"left"}`:
parseDOM reads colspan/rowspan/data-colwidth/style text-align, toDOM emits them
back (`text-align: center/right` inline style renders in-editor). Serializer's
existing `.attrs.alignment || "left"` read now round-trips GFM separators
byte-perfectly. tableRole/isolating preserved so prosemirror-tables'
TableView/columnResizing keep working.

### Verification protocol

1. Extend `/tmp/opencode/table-parse.ts` corpus: aligned cols, escaped pipes,
   `<br>` cells, bold/code/link/strike, empty cells, missing trailing pipe,
   leading-pipe-less rows, table adjacent to paragraph, `$math$`, long
   round-trip ×2 stability. All must be STABLE + text-preserving.
2. Re-run corpus against a schema EXACTLY matching ProseKit's cell attrs.
3. `bun --bun tsc --noEmit`; full `bun lib/build.ts` (parser touched TS only —
   build still wise since dirty-plugin baselines serialize docs).
4. Optional Playwright smoke (existing shadow-content harness, port 32600):
   load a page with a table, edit a cell, save, assert disk content unchanged
   apart from the edit.

---

## 6. Desktop table-handle UI — QUEUED (direction approved)

Adopt `@prosekit/web/table-handle` custom elements for PC builds only;
keep the in-house quick-bar (`edit-toolbar-controller.ts`, cmds tc-14..tc-18)
untouched for mobile/tablet.

Docs structure (prosekit.dev/components/table-handle): composition of
Root / DragPreview / DropIndicator / Column+Row Positioner / Popup /
MenuRoot / MenuTrigger + generic menu positioner/popup/items wired to commands
(`addTableColumnBefore/After`, `addTableRowAbove/Below`, `deleteTableColumn/
Row/Table`, `deleteCellSelection`). Vanilla usage = register elements, set
`editor` prop on positioner-class elements (`SharedTableHandlePositionerProps.editor`),
own the menu item markup + canExec refresh ourselves (the React demo derives
these via `useEditorDerivedValue`; vanilla equivalent = subscribe to
transactions and toggle `can-exec`/disabled states).

Integration notes gathered:

- Drag plumbing pre-wired: `table-block-view.ts` stopEvents passes
  `[data-role="col-drag-handle"], [data-role="row-drag-handle"]`;
  `editor-drag-drop.ts` ignores those drags. ProseKit drags announce
  `application/x-prosekit-table-handle-drag`; `defineTableDropIndicator` exists
  in the extensions package for the drop preview.
- Mount point precedent: SlashView/BlockHandleView mount to `view.dom.parentNode`
  (`#inb4doc-editor`) and convert `view.coordsAtPos()` viewport coords to
  container-relative. Table handles self-position (floating-ui) but live in the
  same container.
- Gate via `hasFunc(AppFunc.X)` / non-mobile-dock check per AGENTS.md
  build-mode rules; do NOT scatter BuildMode string checks.
- Styling: component ships its own CSS import; restyle triggers/popups to Nord
  vars (`--color-*` from foundation/base.css; danger = `--color-error`, NOT
  `--color-danger`). Mind CSS cascade rule: templates/styles/*.eta win ties —
  scope modifiers under parent classes.
- Bonus fixes while in there: wire the currently-dead stubs
  (`ToolbarCommand.RemoveRow/DeleteCol/RemoveTable` partially no-op in
  `editor-mutation-service.ts`) or hide those buttons until implemented.

Steps: register elements → new plugin/controller creating the DOM tree +
command wiring + transaction-driven menu-state refresh → CSS theme → gate to
desktop → tsc + build → Playwright smoke on port 32600.

---

## 7. Ctrl+X table cut — DONE

`cutBlock` (keyboard.ts) used to NodeSelect the block, overlay a synthetic DOM
Range over `nodeDOM(pos)` contents, and `execCommand("cut")`. For tables that
degrades: a browser Range cannot contain a `<table>` element whole, so the
selection collapses onto the cells' inline content — clipboard got cell text,
cells were purged, empty shell remained. (PM's own cut handler would have been
correct — serialize state-selection + `deleteSelection` — but the DOM-range
step derails it for table nodes.)

Fix: table case bypasses execCommand entirely —

```ts
const slice = state.doc.slice(pos, pos + node.nodeSize)
const { dom, text } = view.serializeForClipboard(slice)
navigator.clipboard.write([new ClipboardItem({ "text/html": …dom.innerHTML…, "text/plain": …text… })])
tr.delete(pos, pos + node.nodeSize)  // + empty-paragraph guard if doc empties
```

Called synchronously inside the keydown stack (transient activation present).
Clipboard write is fire-and-forget; deletion applies even if the write is
denied. Other blocks keep the existing NodeSelection/execCommand path.

---

## Invariants to respect (from AGENTS.md, relevant here)

- Content-loss rules: empty-string body is valid; serializer changes must not
  alter round-trip of EXISTING docs beyond fixing brokenness.
- No document/window listeners outside keyboard.ts — table-handle internals use
  shadow-DOM-scoped listeners (allowed); don't add raw global listeners for it.
- Verify CSS var names against declarations; icons via `src/eta/icons.ts` names
  (grep before use; iconoir set).
