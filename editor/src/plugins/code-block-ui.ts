import { defineNodeView } from "@prosekit/core";
import type { EditorView as PMEditorView } from "prosemirror-view";
import type { Node } from "prosemirror-model";

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

const shikiIdToName = new Map<string, string>();
for (const lang of LANGS) {
  shikiIdToName.set(lang.shikiId, lang.name);
}

function resolveLang(value: string): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  return aliasToName.get(lower) ?? shikiIdToName.get(lower) ?? value;
}

const nameToShikiId = new Map<string, string>();
for (const lang of LANGS) {
  nameToShikiId.set(lang.name, lang.shikiId);
}

/** Canonical language name → Shiki grammar id. Empty for plain text. */
export function toShikiId(canonical: string): string {
  return nameToShikiId.get(canonical) ?? canonical.toLowerCase();
}

// ---- Language picker (native select, per prosekit example) ----
//
// A native <select> needs no focus juggling, no positioning and no custom
// keyboard handling — the browser owns all of it. Unknown languages stored
// in markdown get a dynamic option so the select never lies about the value.

class LanguageSelect {
  dom: HTMLSelectElement;
  private currentValue = "";
  private onChange: (value: string) => void;

  constructor(onChange: (value: string) => void) {
    this.onChange = onChange;

    this.dom = document.createElement("select");
    this.dom.className = "code-block-lang-select";
    this.dom.setAttribute("aria-label", "Code block language");
    this.dom.spellcheck = false;

    const plain = document.createElement("option");
    plain.value = "";
    plain.textContent = "Plain Text";
    this.dom.appendChild(plain);
    for (const lang of allLangs) {
      const opt = document.createElement("option");
      opt.value = lang.canonical;
      opt.textContent = lang.display;
      this.dom.appendChild(opt);
    }

    this.dom.addEventListener("change", () => {
      this.currentValue = this.dom.value;
      this.onChange(toShikiId(this.dom.value));
    });
  }

  get value(): string {
    return this.currentValue;
  }

  set value(v: string) {
    this.currentValue = v;
    if (v && ![...this.dom.options].some((o) => o.value === v)) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      this.dom.appendChild(opt);
    }
    this.dom.value = v;
  }
}

// ---- Native code block node view ----
//
// The code block content is ordinary editable ProseMirror text living in
// `contentDOM` (a <pre>). Arrow-key entry/exit across block boundaries is
// native PM behavior — no nested editor, no selection syncing. The node view
// only provides chrome: line-number gutter, language picker and copy button.
// (Block math is a dedicated `mathBlock` node — see src/plugins/math.ts.)

class CodeBlockView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: Node;
  private pmView: PMEditorView;
  private getPos: () => number | undefined;
  private gutter: HTMLElement;
  private overlay: HTMLElement;
  private langSelect: LanguageSelect;
  private copyBtn: HTMLElement;
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

    this.overlay = document.createElement("div");
    this.overlay.className = "code-block-overlay";
    this.overlay.setAttribute("contenteditable", "false");

    this.langSelect = new LanguageSelect((name) => this.setLanguage(name));
    this.langSelect.value = resolveLang(node.attrs.language ?? "");

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

    this.overlay.appendChild(this.langSelect.dom);
    this.overlay.appendChild(this.copyBtn);

    this.dom.appendChild(this.gutter);
    this.dom.appendChild(this.contentDOM);
    this.dom.appendChild(this.overlay);

    this.languageName = resolveLang(node.attrs.language ?? "");
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

  // ---- PM NodeView API ----

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;

    const canonical = resolveLang(node.attrs.language ?? "");
    if (canonical !== this.languageName) {
      this.languageName = canonical;
      this.langSelect.value = canonical;
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

  // Chrome (gutter, language picker, copy button) must not
  // leak events into ProseMirror: a bubbled mousedown from the picker list
  // makes PM resolve a doc position under the cursor, steal focus from the
  // picker input (blur → hide) and cancel the pick. Events targeting the
  // editable contentDOM stay native.
  stopEvent(event: Event): boolean {
    const target = event.target as Element | null;
    return !(target && this.contentDOM.contains(target));
  }

  ignoreMutation(mutation: {
    type: string;
    target: EventTarget | null;
  }): boolean {
    const target = mutation.target as Element | null;
    return !target || !this.contentDOM.contains(target);
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
