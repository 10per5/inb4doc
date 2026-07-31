import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import type { NodeViewConstructor } from "@milkdown/kit/prose/view";
import type { EditorView as PMEditorView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { exitCode } from "@milkdown/kit/prose/commands";
import { redo, undo } from "@milkdown/kit/prose/history";

import { createEditor } from "prism-code-editor";
import type { PrismEditor } from "prism-code-editor";
import { matchBrackets } from "prism-code-editor/match-brackets";
import { highlightBracketPairs } from "prism-code-editor/highlight-brackets";
import { editorCommands, defaultKeymap, addEditorHotkey } from "prism-code-editor/commands";
import "prism-code-editor/layout.css";
import "prism-code-editor/themes/atom-one-dark.css";

import { renderLatex } from "@/plugins/math";
import { LANG_IMPORTS } from "@/plugins/code-block-langs";
import { copy } from "@/eta/icons";

// ---- Language registry ----

interface PrismLang {
  name: string;
  alias: readonly string[];
  prismId: string;
  behavior?: string;
}

const PRISM_LANGS: PrismLang[] = [
  { name: "JavaScript", alias: ["js", "mjs", "cjs"], prismId: "javascript", behavior: "clike" },
  { name: "TypeScript", alias: ["ts"], prismId: "typescript", behavior: "clike" },
  { name: "JSX", alias: [], prismId: "jsx", behavior: "jsx" },
  { name: "TSX", alias: [], prismId: "tsx", behavior: "tsx" },
  { name: "Python", alias: ["py", "python3"], prismId: "python", behavior: "python" },
  { name: "HTML", alias: ["htm", "xhtml"], prismId: "markup", behavior: "html" },
  { name: "XML", alias: ["svg", "mathml"], prismId: "xml", behavior: "html" },
  { name: "CSS", alias: ["scss", "less"], prismId: "css", behavior: "css" },
  { name: "Shell", alias: ["bash", "sh", "zsh", "shell"], prismId: "bash" },
  { name: "JSON", alias: [], prismId: "json" },
  { name: "YAML", alias: ["yml"], prismId: "yaml" },
  { name: "TOML", alias: [], prismId: "toml" },
  { name: "Markdown", alias: ["md"], prismId: "markdown", behavior: "html" },
  { name: "LaTeX", alias: ["tex"], prismId: "latex" },
  { name: "Rust", alias: ["rs"], prismId: "rust", behavior: "clike" },
  { name: "Go", alias: ["golang"], prismId: "go", behavior: "clike" },
  { name: "Java", alias: [], prismId: "java", behavior: "clike" },
  { name: "C", alias: ["h"], prismId: "c", behavior: "clike" },
  { name: "C++", alias: ["cpp", "cxx", "hpp"], prismId: "cpp", behavior: "clike" },
  { name: "C#", alias: ["csharp", "dotnet"], prismId: "csharp", behavior: "clike" },
  { name: "Kotlin", alias: ["kt", "kts"], prismId: "kotlin", behavior: "clike" },
  { name: "Dart", alias: [], prismId: "dart", behavior: "clike" },
  { name: "Swift", alias: [], prismId: "swift" },
  { name: "Ruby", alias: ["rb"], prismId: "ruby", behavior: "ruby" },
  { name: "PHP", alias: [], prismId: "php", behavior: "php" },
  { name: "SQL", alias: ["mysql", "postgresql"], prismId: "sql", behavior: "sql" },
  { name: "GraphQL", alias: ["gql"], prismId: "graphql" },
  { name: "Docker", alias: ["dockerfile"], prismId: "docker" },
  { name: "Nginx", alias: [], prismId: "nginx" },
  { name: "Git", alias: [], prismId: "git" },
  { name: "Diff", alias: [], prismId: "diff" },
  { name: "Makefile", alias: ["make"], prismId: "makefile" },
  { name: "INI", alias: ["cfg", "conf"], prismId: "ini" },
  { name: "Lua", alias: [], prismId: "lua", behavior: "lua" },
  { name: "Elixir", alias: ["ex", "exs"], prismId: "elixir" },
  { name: "Haskell", alias: ["hs"], prismId: "haskell" },
  { name: "Julia", alias: ["jl"], prismId: "julia" },
  { name: "R", alias: [], prismId: "r" },
  { name: "Perl", alias: ["pl"], prismId: "perl" },
  { name: "Clojure", alias: ["clojure", "cl"], prismId: "clojure" },
  { name: "PowerShell", alias: ["ps", "ps1"], prismId: "powershell", behavior: "batch" },
  { name: "Batch", alias: ["bat", "cmd"], prismId: "batch", behavior: "batch" },
  { name: "HTTP", alias: [], prismId: "http" },
  { name: "Regex", alias: ["regexp"], prismId: "regex" },
  { name: "Vim", alias: [], prismId: "vim" },
  { name: "Zig", alias: [], prismId: "zig", behavior: "clike" },
  { name: "SCSS", alias: [], prismId: "scss" },
  { name: "Less", alias: [], prismId: "less" },
];

const DISPLAY_OVERRIDE: Record<string, string> = {
  Shell: "Bash",
};

interface DisplayLang {
  display: string;
  canonical: string;
  alias: readonly string[];
}

const allLangs: DisplayLang[] = PRISM_LANGS.map((l) => ({
  display: DISPLAY_OVERRIDE[l.name] ?? l.name,
  canonical: l.name,
  alias: l.alias,
}));

const aliasToName = new Map<string, string>();
for (const lang of PRISM_LANGS) {
  aliasToName.set(lang.name.toLowerCase(), lang.name);
  for (const a of lang.alias) {
    aliasToName.set(a.toLowerCase(), lang.name);
  }
}

function resolveLang(value: string): string {
  if (!value) return "";
  return aliasToName.get(value.toLowerCase()) ?? value;
}

const nameToPrismId = new Map<string, string>();
for (const lang of PRISM_LANGS) {
  nameToPrismId.set(lang.name, lang.prismId);
}

function toPrismId(canonical: string): string {
  return nameToPrismId.get(canonical) ?? canonical.toLowerCase();
}

const loadedGrammars = new Map<string, Promise<void>>();

function loadLanguage(language: string): Promise<void> {
  if (!language) return Promise.resolve();
  const existing = loadedGrammars.get(language);
  if (existing) return existing;
  const imp = LANG_IMPORTS[language];
  const promise = (imp ? imp() : Promise.resolve()).catch((error) => {
    loadedGrammars.delete(language);
    throw error;
  });
  loadedGrammars.set(language, promise);
  return promise;
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
    this.input.addEventListener("keydown", (e) => this.onKeydown(e));
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
        this.hide();
        this.input.blur();
        break;
    }
  }
}

// ---- Prism editor block ----

class PrismEditorBlock {
  dom: HTMLElement;
  editor!: PrismEditor;

  private node: Node;
  private pmView: PMEditorView;
  private getPos: () => number | undefined;
  private initialized = false;
  private updating = false;
  private languageName = "";
  private overlay: HTMLElement;
  private langPicker: LanguagePicker;
  private copyBtn: HTMLElement;
  private previewPanel: HTMLElement;
  private langLoadId = 0;
  private oldValue = "";
  private cleanupFns: (() => void)[] = [];
  private keymap: Record<string, any>;

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

    this.previewPanel = document.createElement("div");
    this.previewPanel.className = "code-block-preview";

    this.overlay = document.createElement("div");
    this.overlay.className = "code-block-overlay";

    this.langPicker = new LanguagePicker((name) => {
      this.setLanguage(name);
      this.editor?.textarea.focus();
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
    this.dom.appendChild(this.overlay);

    const { "Mod-Enter": _modEnter, ...rest } = defaultKeymap;
    this.keymap = rest;

    this.initializeEditor();
  }

  private initializeEditor() {
    if (this.initialized) return;
    this.initialized = true;

    this.editor = createEditor(
      null,
      {
        language: "text",
        readOnly: !this.pmView.editable,
        lineNumbers: true,
        tabSize: 2,
        insertSpaces: true,
        value: this.node.textContent ?? "",
      },
      matchBrackets(),
      highlightBracketPairs(),
      editorCommands(this.keymap, undefined, undefined),
    );

    this.oldValue = this.editor.value;

    this.cleanupFns.push(
      this.editor.on("update", this.forwardUpdate),
    );

    const pm = this.pmView;

    this.cleanupFns.push(
      addEditorHotkey(this.editor, "Mod-z", () => {
        undo(pm.state, pm.dispatch);
        return true;
      }),
      addEditorHotkey(this.editor, "Mod-y", () => {
        redo(pm.state, pm.dispatch);
        return true;
      }),
      addEditorHotkey(this.editor, "Shift-Mod-z", () => {
        redo(pm.state, pm.dispatch);
        return true;
      }),
      addEditorHotkey(this.editor, "Mod-Enter", () => {
        exitCode(pm.state, pm.dispatch);
        pm.focus();
        return true;
      }),
      addEditorHotkey(this.editor, "ArrowUp", () => {
        return this.maybeEscape("line", -1) || undefined;
      }),
      addEditorHotkey(this.editor, "ArrowLeft", () => {
        return this.maybeEscape("char", -1) || undefined;
      }),
      addEditorHotkey(this.editor, "ArrowDown", () => {
        return this.maybeEscape("line", 1) || undefined;
      }),
      addEditorHotkey(this.editor, "ArrowRight", () => {
        return this.maybeEscape("char", 1) || undefined;
      }),
      addEditorHotkey(this.editor, "Backspace", () => {
        return this.backspaceToParagraph() || undefined;
      }),
    );

    this.dom.insertBefore(this.editor.container, this.overlay);
    this.dom.insertBefore(this.previewPanel, this.overlay);

    this.updateLanguage();
    this.editor.textarea.focus();
  }

  // ---- Change forwarding ----

  private forwardUpdate = (value: string) => {
    if (this.updating) return;

    const [start, end] = this.editor.getSelection();
    let offset = (this.getPos() ?? 0) + 1;
    const selFrom = offset + start;
    const selTo = offset + end;
    const pmSel = this.pmView.state.selection;

    const change = computeChange(this.oldValue, value);
    if (change) {
      this.updating = true;
      const tr = this.pmView.state.tr;
      if (change.text) {
        tr.replaceWith(
          offset + change.from,
          offset + change.to,
          this.pmView.state.schema.text(change.text),
        );
      } else {
        tr.delete(offset + change.from, offset + change.to);
      }
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
      this.pmView.dispatch(tr);
      this.updatePreview();
      this.updating = false;
    } else if (pmSel.from !== selFrom || pmSel.to !== selTo) {
      const tr = this.pmView.state.tr;
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
      this.pmView.dispatch(tr);
    }

    this.oldValue = value;
  };

  private maybeEscape(unit: "line" | "char", dir: -1 | 1): boolean {
    const [start, end] = this.editor.getSelection();
    if (start !== end) return false;

    const text = this.editor.value;
    const pos = start;

    if (unit === "line") {
      const before = text.slice(0, pos);
      const lineIdx = before.split("\n").length - 1;
      const totalLines = text.length === 0 ? 1 : text.split("\n").length;
      if (dir < 0 ? lineIdx > 0 : lineIdx < totalLines - 1) return false;
    } else {
      if (dir < 0 ? pos > 0 : pos < text.length) return false;
    }

    const targetPos =
      (this.getPos() ?? 0) + (dir < 0 ? 0 : this.node.nodeSize);
    const selection = TextSelection.near(
      this.pmView.state.doc.resolve(targetPos),
      dir,
    );
    this.pmView.dispatch(
      this.pmView.state.tr.setSelection(selection).scrollIntoView(),
    );
    this.pmView.focus();
    return true;
  }

  private backspaceToParagraph(): boolean {
    const text = this.editor.value;
    const [start, end] = this.editor.getSelection();
    if (start !== end || start !== 0) return false;
    if (text.includes("\n")) return false;

    const state = this.pmView.state;
    const pos = this.getPos() ?? 0;
    const tr = state.tr.replaceWith(
      pos,
      pos + this.node.nodeSize,
      state.schema.nodes.paragraph!.createChecked({}, this.node.content),
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    this.pmView.dispatch(tr);
    this.pmView.focus();
    return true;
  }

  // ---- Language handling ----

  private async updateLanguage() {
    const languageName = this.node.attrs.language as string | undefined;
    const canonical = resolveLang(languageName ?? "");
    if (canonical === this.languageName) return;
    this.languageName = canonical;
    this.langPicker.value = canonical;

    if (!this.initialized) return;
    this.updatePreview();

    const prismId = toPrismId(canonical);
    if (!prismId) {
      this.editor.setOptions({ language: "text" });
      return;
    }

    const id = ++this.langLoadId;
    await loadLanguage(prismId);
    if (id !== this.langLoadId) return;
    this.editor.setOptions({ language: prismId });
  }

  private updatePreview() {
    const isLatex = this.languageName === "LaTeX";
    this.dom.classList.toggle("latex", isLatex);
    if (isLatex) {
      const content = this.editor.value;
      this.previewPanel.innerHTML = renderLatex(content, true);
      this.previewPanel.style.display = "block";
      this.editor.container.style.borderTop = "1px solid #3b4252";
    } else {
      this.previewPanel.style.display = "none";
      this.editor.container.style.borderTop = "none";
    }
  }

  // ---- PM NodeView API ----

  setSelection(anchor: number, head: number) {
    if (!this.initialized) this.initializeEditor();
    if (!this.editor.container.isConnected) return;
    this.editor.textarea.focus();
    this.updating = true;
    this.editor.textarea.setSelectionRange(
      Math.min(anchor, head),
      Math.max(anchor, head),
      anchor > head ? "backward" : "forward",
    );
    this.updating = false;
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    if (this.updating) return true;
    this.node = node;
    if (!this.initialized) return true;

    this.editor.setOptions({ readOnly: !this.pmView.editable });

    const newLang = resolveLang(node.attrs.language ?? "");
    if (newLang !== this.languageName) {
      this.languageName = newLang;
      this.langPicker.value = newLang;
      if (!this.initialized) return true;
      this.updatePreview();

      const prismId = toPrismId(newLang);
      if (!prismId) {
        this.editor.setOptions({ language: "text" });
      } else {
        const id = ++this.langLoadId;
        loadLanguage(prismId).then(() => {
          if (id === this.langLoadId) {
            this.editor.setOptions({ language: prismId });
          }
        });
      }
    }

    const currentText = this.editor.value;
    const newText = node.textContent ?? "";
    const change = computeChange(currentText, newText);
    if (change) {
      this.updating = true;
      this.editor.setOptions({ value: newText });
      this.oldValue = newText;
      this.updating = false;
    }

    this.updatePreview();
    return true;
  }

  selectNode() {
    if (!this.initialized) this.initializeEditor();
    this.dom.classList.add("selected");
    this.overlay.classList.add("visible");
    this.editor?.textarea.focus();
  }

  deselectNode() {
    this.dom.classList.remove("selected");
    this.overlay.classList.remove("visible");
  }

  stopEvent() {
    return true;
  }

  destroy() {
    if (this.initialized) {
      for (const fn of this.cleanupFns) fn();
      this.cleanupFns = [];
      this.editor.remove();
    }
  }

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
    const text = this.editor?.value ?? this.node.textContent ?? "";

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

// ---- Diff helper ----

function computeChange(
  oldVal: string,
  newVal: string,
): { from: number; to: number; text: string } | null {
  if (oldVal === newVal) return null;
  let start = 0;
  let oldEnd = oldVal.length;
  let newEnd = newVal.length;
  while (
    start < oldEnd &&
    oldVal.charCodeAt(start) === newVal.charCodeAt(start)
  )
    ++start;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldVal.charCodeAt(oldEnd - 1) === newVal.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return { from: start, to: oldEnd, text: newVal.slice(start, newEnd) };
}

// ---- Export ----

export const codeBlockUI = $view(
  codeBlockSchema.node,
  (): NodeViewConstructor => (node, view, getPos) =>
    new PrismEditorBlock(node, view, getPos),
);
