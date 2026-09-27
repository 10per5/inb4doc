# inb4doc — Bug/Feature Triage (prioritized by difficulty)

Ordered **easiest → hardest**. Each item notes the file(s) to touch and a rough size.
Items 1–3 are the "easy wins" targeted first in this pass.

## Tier 1 — Easy (CSS or single-function fixes)
1. **Caret invisible in dark/normal mode** — `#5`
   - `src/styles/foundation/base.css` (add `--color-caret` to `:root` + dark) and
     `src/styles/editor/editor.css` (`.ProseMirror { caret-color }`).
   - No logic; pick a high-contrast color (uses `--color-accent` already visible in both themes).
2. **Closing inline-code backtick leaves a stray `` ` ``** — `#11`
   - `src/plugins/inline-code-input.ts` `convertClosing()`: also delete the typed
     closing backtick and place the caret after it (so it "exits" the code span).
   - ~5 lines.
3. **Ctrl+Home reaches first block but scroll not reset to 0** — `#1`
   - `src/plugins/keyboard.ts` keymap: add `Mod-Home` / `Mod-End` → select doc
     start/end **and** force-scroll the `.book-layout` container to top/bottom.
   - ~15 lines.

## Tier 2 — Easy/Medium
4. **Navigation should scroll to open document on first render/app open** — `#12`
   - Wire scroll restoration (or scroll-to-top) when a page loads in
     `editor-controller.ts` / navigation flow.
5. **Home pressed twice** should step line→paragraph→doc — `#4`
   - Extend `homeToBlockStart` to track press state: 1st → block/line start,
     2nd → paragraph start, 3rd → doc/section start.
6. **Topbar hides too eagerly in GUI and won't reshow on scroll-up** — `#6`
   - `src/controllers/topbar-controller.ts` visibility thresholds / scroll handler.
7. **Tablet can create file with same name as a folder** — `#9`
   - Add name-collision validation (file vs folder) in create flow + clearer errors.
8. **Code block not opened via ` ```js `** — `#3`
   - Fenced input rule not firing; check `src/config/prosekit-basic.ts` codeBlock
     extension / input rule wiring.

## Tier 3 — Medium/Hard
9. **Indenting checkboxes resets to single indent on reload** — `#2`
   - Task-list serialization round-trip loses nesting; fix in markdown parse/serialize.
10. **`@` mention doesn't work** — `#10`
    - `src/plugins/mention.ts` is currently a stub (does nothing). Needs full
      implementation (popup, query, suggestion insert).

## Tier 4 — Hard (cross-cutting / GUI build)
11. **External nav re-enabled in GUI** — `#7`
    - Saucer/Qt WebView navigation policy: block new-tab / off-`app://` nav in GUI mode.
12. **Source-code editor reusing ProseKit + block-based search** — `#8`
    - Larger feature: reuse editor core for a raw-source view; update search/scroll
      lookups for the block editor.

---
### Status
- [x] Plan written
- [x] #5 caret color — `base.css` + `editor.css`
- [x] #11 inline code closing backtick — reordered custom plugin before `defineCode()` input rule (`editor-config.ts`)
- [x] #1 ctrl+home / ctrl+end scroll — `keyboard.ts` `Mod-Home`/`Mod-End` + `scrollContainersTo`
- [x] #4 staged Home (line → paragraph → doc) — `keyboard.ts` `homeStaged` + `visualLineStart`
- [x] #12 scroll to open document on load — `editor-controller.ts` `scrollEditorToTop`
- [x] #6 topbar auto-hide won't reshow — `toolbar-store.ts` direction-based show/hide
- [x] #9 create file with same name as folder — `editor-actions.ts` dir-conflict guard + clearer errors
- [x] #3 code block via ` ```js ` — guarded inline-code plugin so it no longer eats fence backticks
- [x] #2 checkbox indent resets on reload — `editor-markdown.ts` `list` serializer double-marked nested lists (`- [ ] - [ ] sub`); now wraps nested `list` children with empty firstDelim so they keep their own markers + indentation
- [ ] #10 mention `@` (mention plugin is a stub)
- [ ] #7 external nav in GUI (Sauber/Qt webview policy)
- [ ] #8 source editor reusing ProseKit + block-based search
