import { defineNodeView } from "@prosekit/core";
import type { EditorView as PMEditorView } from "prosemirror-view";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

import { renderLatex } from "@/plugins/math";
import { copy } from "@/eta/icons";

// ---- Language registry ----

interface CodeLang {
  name: string;
  alias: readonly string[];
  shikiId: string;
}

const LANGS: CodeLang[] = [
  { name: "JavaScript", alias: ["js", "mjs", "cjs"], shikiId: "javascript" },
  { name: "TypeScript", alias: ["ts"], shikiId: "typescript" },
  { name: "JSX", alias: [], shikiId: "jsx" },
  { name: "TSX", alias: [], shikiId: "tsx" },
  { name: "Python", alias: ["py", "python3"], shikiId: "python" },
  { name: "HTML", alias: ["htm", "xhtml"], shikiId: "html" },
  { name: "XML", alias: ["svg", "mathml"], shikiId: "xml" },
  { name: "CSS", alias: [], shikiId: "css" },
  { name: "Shell", alias: ["bash", "sh", "zsh", "shell"], shikiId: "bash" },
  { name: "JSON", alias: [], shikiId: "json" },
  { name: "YAML", alias: ["yml"], shikiId: "yaml" },
  { name: "TOML", alias: [], shikiId: "toml" },
  { name: "Markdown", alias: ["md"], shikiId: "markdown" },
  { name: "LaTeX", alias: ["tex"], shikiId: "latex" },
  { name: "Rust", alias: ["rs"], shikiId: "rust" },
  { name: "Go", alias: ["golang"], shikiId: "go" },
  { name: "Java", alias: [], shikiId: "java" },
  { name: "C", alias: ["h"], shikiId: "c" },
  { name: "C++", alias: ["cpp", "cxx", "hpp"], shikiId: "cpp" },
  { name: "C#", alias: ["csharp", "dotnet"], shikiId: "csharp" },
  { name: "Kotlin", alias: ["kt", "kts"], shikiId: "kotlin" },
  { name: "Dart", alias: [], shikiId: "dart" },
  { name: "Swift", alias: [], shikiId: "swift" },
  { name: "Ruby", alias: ["rb"], shikiId: "ruby" },
  { name: "PHP", alias: [], shikiId: "php" },
  { name: "SQL", alias: ["mysql", "postgresql"], shikiId: "sql" },
  { name: "GraphQL", alias: ["gql"], shikiId: "graphql" },
  { name: "Docker", alias: ["dockerfile"], shikiId: "dockerfile" },
  { name: "Nginx", alias: [], shikiId: "nginx" },
  { name: "Git", alias: [], shikiId: "git" },
  { name: "Diff", alias: [], shikiId: "diff" },
  { name: "Makefile", alias: ["make"], shikiId: "makefile" },
  { name: "INI", alias: ["cfg", "conf"], shikiId: "ini" },
  { name: "Lua", alias: [], shikiId: "lua" },
  { name: "Elixir", alias: ["ex", "exs"], shikiId: "elixir" },
  { name: "Haskell", alias: ["hs"], shikiId: "haskell" },
  { name: "Julia", alias: ["jl"], shikiId: "julia" },
  { name: "R", alias: [], shikiId: "r" },
  { name: "Perl", alias: ["pl"], shikiId: "perl" },
  { name: "Clojure", alias: ["clojure", "cl"], shikiId: "clojure" },
  { name: "PowerShell", alias: ["ps", "ps1"], shikiId: "powershell" },
  { name: "Batch", alias: ["bat", "cmd"], shikiId: "batch" },
  { name: "HTTP", alias: [], shikiId: "http" },
  { name: "Regex", alias: ["regexp"], shikiId: "regex" },
  { name: "Vim", alias: [], shikiId: "vim" },
  { name: "Zig", alias: [], shikiId: "zig" },
  { name: "SCSS", alias: [], shikiId: "scss" },
  { name: "Less", alias: [], shikiId: "less" },
];

const DISPLAY_OVERRIDE: Record<string, string> = {
  Shell: "Bash",
};

interface DisplayLang {
  display: string;
  canonical: string;
  alias: readonly string[];
}

const allLangs: DisplayLang[] = LANGS.map((l) => ({
  display: DISPLAY_OVERRIDE[l.name] ?? l.name,
  canonical: l.name,
  alias: l.alias,
}));

const aliasToName = new Map<string, string>();
for (const lang of LANGS) {
  aliasToName.set(lang.name.toLowerCase(), lang.name);
  for (const a of lang.alias) {
    aliasToName.set(a.toLowerCase(), lang.name);
  }
}

function resolveLang(value: string): string {
  if (!value) return "";
  return aliasToName.get(value.toLowerCase()) ?? value;
}

const nameToShikiId = new Map<string, string>();
for (const lang of LANGS) {
  nameToShikiId.set(lang.name, lang.shikiId);
}

/** Canonical language name → Shiki grammar id. Empty for plain text. */
export function toShikiId(canonical: string): string {
  return nameToShikiId.get(canonical) ?? canonical.toLowerCase();
}

// ---- Language picker ----

class LanguagePicker {
  dom: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private currentValue = "";
  private open = false;
  private onChange: (value: string) => void;

  private displayOf(canonical: string): string {
    const found = allLangs.find((l) => l.canonical === canonical);
    return found?.display ?? canonical;
  }

  constructor(onChange: (value: string) => void) {
    this.onChange = onChange;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-lang-picker";

    this.input = document.createElement("input");
    this.input.className = "code-block-lang-input";
    this.input.placeholder = "Language…";
    this.input.spellcheck = false;
    this.input.addEventListener("focus", () => this.show());
    this.input.addEventListener("input", () => {
      this.filter(this.input.value);
      if (!this.open) this.show();
    });
    // Keep PM's keymap away from picker keys; the input owns them.
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      this.onKeydown(e);
    });
    this.input.addEventListener("blur", () => {
      setTimeout(() => this.hide(), 150);
    });
    this.input.addEventListener("mousedown", (e) => e.stopPropagation());
    this.input.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.open) this.hide();
      else this.show();
    });

    this.list = document.createElement("div");
    this.list.className = "code-block-lang-list";
    this.list.addEventListener("mousedown", (e) => e.stopPropagation());

    this.dom.appendChild(this.input);
    this.dom.appendChild(this.list);

    this.renderList("");
  }

  get value(): string {
    return this.currentValue;
  }

  set value(v: string) {
    this.currentValue = v;
    this.input.value = this.displayOf(v);
  }

  focusInput(): void {
    this.input.focus();
  }

  private show() {
    this.open = true;
    this.list.classList.add("visible");
    this.positionList();
    this.filter(this.input.value);
    window.addEventListener("scroll", this.positionList, true);
    window.addEventListener("resize", this.positionList);
  }

  private hide() {
    this.open = false;
    this.list.classList.remove("visible");
    window.removeEventListener("scroll", this.positionList, true);
    window.removeEventListener("resize", this.positionList);
  }

  private positionList = () => {
    const rect = this.input.getBoundingClientRect();
    this.list.style.position = "fixed";
    this.list.style.left = rect.left + "px";
    this.list.style.top = rect.bottom + 4 + "px";
    this.list.style.minWidth = Math.max(rect.width, 160) + "px";
  };

  private filter(query: string) {
    this.renderList(query);
  }

  private renderList(query: string) {
    const q = query.toLowerCase().trim();
    let items: DisplayLang[] = allLangs;
    if (q) {
      items = allLangs.filter(
        (l) =>
          l.display.toLowerCase().includes(q) ||
          l.canonical.toLowerCase().includes(q) ||
          l.alias.some((a) => a.toLowerCase().includes(q)),
      );
    }
    this.list.innerHTML = items
      .map(
        (l) =>
          `<div class="code-block-lang-item${
            l.canonical === this.currentValue ? " selected" : ""
          }" data-lang="${l.canonical}">${l.display}${
            l.alias.length
              ? ' <span class="code-block-lang-alias">' +
                l.alias.slice(0, 4).join(", ") +
                "</span>"
              : ""
          }</div>`,
      )
      .join("");
    for (const item of this.list.children) {
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const lang = (e.currentTarget as HTMLElement).dataset.lang!;
        this.select(lang);
      });
    }
  }

  private select(name: string) {
    this.currentValue = name;
    this.input.value = this.displayOf(name);
    this.hide();
    this.onChange(name);
  }

  private onKeydown(e: KeyboardEvent) {
    const items = this.list.querySelectorAll(".code-block-lang-item");
    const focused = this.list.querySelector(".focused") as HTMLElement | null;
    let idx = focused ? Array.from(items).indexOf(focused) : -1;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        idx = Math.min(idx + 1, items.length - 1);
        items[idx]?.classList.add("focused");
        items[idx]?.scrollIntoView({ block: "nearest" });
        break;
      case "ArrowUp":
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        items[idx]?.classList.add("focused");
        items[idx]?.scrollIntoView({ block: "nearest" });
        break;
      case "Enter":
        e.preventDefault();
        if (focused) {
          const lang = focused.dataset.lang!;
          this.select(lang);
        }
        break;
      case "Escape":
        e.preventDefault();
        this.hide();
        this.input.blur();
        break;
    }
  }
}

// ---- Native code block node view ----
//
// The code block content is ordinary editable ProseMirror text living in
// `contentDOM` (a <pre>). Arrow-key entry/exit across block boundaries is
// native PM behavior — no nested editor, no selection syncing. The node view
// only provides chrome: line-number gutter, language picker, copy button and
// the LaTeX preview panel.

class CodeBlockView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: Node;
  private pmView: PMEditorView;
  private getPos: () => number | undefined;
  private gutter: HTMLElement;
  private overlay: HTMLElement;
  private langPicker: LanguagePicker;
  private copyBtn: HTMLElement;
  private previewPanel: HTMLElement;
  private languageName = "";
  private lineCount = -1;

  constructor(
    node: Node,
    view: PMEditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    this.pmView = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";

    this.gutter = document.createElement("div");
    this.gutter.className = "code-block-gutter";
    this.gutter.setAttribute("contenteditable", "false");

    this.contentDOM = document.createElement("pre");
    this.contentDOM.className = "code-block-content";
    this.contentDOM.spellcheck = false;

    this.previewPanel = document.createElement("div");
    this.previewPanel.className = "code-block-preview";

    this.overlay = document.createElement("div");
    this.overlay.className = "code-block-overlay";

    this.langPicker = new LanguagePicker((name) => {
      this.setLanguage(name);
      this.focusContent();
    });
    this.langPicker.value = resolveLang(node.attrs.language ?? "");

    this.copyBtn = document.createElement("button");
    (this.copyBtn as HTMLButtonElement).type = "button";
    this.copyBtn.className = "code-block-copy-btn";
    this.copyBtn.innerHTML = copy;
    this.copyBtn.title = "Copy code";
    this.copyBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    this.copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyCode();
    });
    this.copyBtn.tabIndex = -1;

    this.overlay.appendChild(this.langPicker.dom);
    this.overlay.appendChild(this.copyBtn);

    this.dom.appendChild(this.gutter);
    this.dom.appendChild(this.contentDOM);
    this.dom.appendChild(this.previewPanel);
    this.dom.appendChild(this.overlay);

    this.languageName = resolveLang(node.attrs.language ?? "");
    this.refreshPreview();
    this.updateGutter();
  }

  // ---- Chrome updates ----

  private updateGutter() {
    const lines = this.node.textContent.split("\n").length;
    if (lines === this.lineCount) return;
    this.lineCount = lines;

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lines; i++) {
      const span = document.createElement("span");
      span.className = "code-block-line-no";
      span.textContent = String(i);
      frag.appendChild(span);
    }
    this.gutter.replaceChildren(frag);
  }

  private refreshPreview() {
    const isLatex = this.languageName === "LaTeX";
    this.dom.classList.toggle("latex", isLatex);
    if (isLatex) {
      this.previewPanel.innerHTML = renderLatex(this.node.textContent, true);
      this.previewPanel.style.display = "block";
    } else {
      this.previewPanel.style.display = "none";
    }
  }

  /** Place the PM caret at the end of this block's content and focus it. */
  private focusContent() {
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const $pos = this.pmView.state.doc.resolve(pos + this.node.nodeSize - 1);
    const selection = TextSelection.near($pos, -1);
    this.pmView.dispatch(
      this.pmView.state.tr.setSelection(selection).scrollIntoView(),
    );
    this.pmView.focus();
  }

  // ---- PM NodeView API ----

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;

    const canonical = resolveLang(node.attrs.language ?? "");
    if (canonical !== this.languageName) {
      this.languageName = canonical;
      this.langPicker.value = canonical;
      this.refreshPreview();
    }
    this.updateGutter();
    return true;
  }

  selectNode() {
    this.dom.classList.add("selected");
    this.overlay.classList.add("visible");
  }

  deselectNode() {
    this.dom.classList.remove("selected");
    this.overlay.classList.remove("visible");
  }

  destroy() {}

  // ---- Helpers ----

  private setLanguage(language: string) {
    this.pmView.dispatch(
      this.pmView.state.tr.setNodeAttribute(
        this.getPos() ?? 0,
        "language",
        language,
      ),
    );
  }

  private copyCode() {
    const text = this.node.textContent ?? "";

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);

    if (!ok) {
      const p = navigator.clipboard?.writeText?.(text);
      if (p) {
        p.catch(() => {
          const saucer = (window as any).saucer;
          if (saucer?.exposed?._nativeCopy)
            saucer.exposed._nativeCopy(text);
        });
      } else {
        const saucer = (window as any).saucer;
        if (saucer?.exposed?._nativeCopy)
          saucer.exposed._nativeCopy(text);
      }
    }

    this.copyBtn.classList.add("copied");
    setTimeout(() => this.copyBtn.classList.remove("copied"), 1500);
  }
}

// ---- Export ----

export const codeBlockUI = defineNodeView({
  name: "codeBlock",
  constructor: (node, view, getPos) => new CodeBlockView(node, view, getPos),
});
