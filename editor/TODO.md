# TODO — predoc editor improvements

## 2d. LaTeX math — COMPLETED
- Added `katex`, `remark-math`, `unist-util-visit` deps
- Created `src/plugins/math.ts` with inline math (`$...$`) rendered via KaTeX and block math (`$$...$$`) as LaTeX code blocks serialized back to `math` AST
- Inline math: custom `math_inline` node rendered with KaTeX
- Block math: remark transforms `math` blocks to code blocks with `lang: "LaTeX"`, serialized back to `$$...$$` via `blockLatexSchema`
- Input rules: `$...$` → inline math, `$$` → code block with LaTeX
- Toggle command for inline math
- Wired up in editor-service.ts (`.use()` chain)
- KaTeX CSS imported in app.ts
- Pending: inline math tooltip for editing (medium priority)

## 2e. Code block language selector + copy button — COMPLETED
- Created `src/plugins/code-block-ui.ts` with a custom `$view` for `code_block`
- Language selector: native `<select>` overlay with 40+ languages (appears on hover/select)
- Copy button: copies code block content to clipboard with "Copied!" feedback
- Overlay styling: buttons appear as semi-transparent overlay in top-right corner, code content has proper padding
- Added `/math` and `/latex` slash commands to create LaTeX code blocks via `convertToMathBlock`

## AI integration — Concept (ObservableHQ / Jupyter-style)
- `/` invokes a command palette that includes an "AI generate" option
- Opens a prompt input box (like Crepe's `AIInstructionTooltip`) where user describes what they want
- AI generates markdown content and inserts it into the editor at cursor
- **Future considerations:**
  - Cell-based interface (like ObservableHQ where each block is a cell)
  - Multi-provider support (OpenAI, Anthropic, local)
  - Streaming response with diff review (accept/reject)
  - Potential integration with `/` menu for "Improve writing", "Fix grammar", "Continue", "Summarize"
  - Prompt history and favorites
- Not started — needs separate discussion and scoping
