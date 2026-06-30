import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import type { NodeViewConstructor } from "@milkdown/kit/prose/view";
import type { EditorView as PMEditorView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { exitCode } from "@milkdown/kit/prose/commands";
import { redo, undo } from "@milkdown/kit/prose/history";

import { Compartment, EditorState } from "@codemirror/state";
import type { Line, SelectionRange } from "@codemirror/state";
import {
  EditorView as CodeMirrorView,
  type ViewUpdate,
  keymap,
  drawSelection,
} from "@codemirror/view";
import { basicSetup } from "codemirror";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import type { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { renderLatex } from "./math";

interface LangInfo {
  name: string;
  alias: readonly string[];
}

const DISPLAY_OVERRIDE: Record<string, string> = {
  Shell: "Bash",
};

interface DisplayLang {
  display: string;
  canonical: string;
  alias: readonly string[];
}

const allLangs: DisplayLang[] = languages.map((l) => ({
  display: DISPLAY_OVERRIDE[l.name] ?? l.name,
  canonical: l.name,
  alias: l.alias,
}));

const aliasToName = new Map<string, string>();
for (const lang of languages) {
  aliasToName.set(lang.name.toLowerCase(), lang.name);
  for (const a of lang.alias) {
    aliasToName.set(a.toLowerCase(), lang.name);
  }
}

function resolveLang(value: string): string {
  if (!value) return "";
  return aliasToName.get(value.toLowerCase()) ?? value;
}

class LanguageLoader {
  private map: Record<string, LanguageDescription> = {};

  constructor() {
    for (const lang of languages) {
      for (const alias of lang.alias) {
        this.map[alias.toLowerCase()] = lang;
      }
      this.map[lang.name.toLowerCase()] = lang;
    }
  }

  load(languageName: string): Promise<LanguageSupport | undefined> {
    const canonical = resolveLang(languageName);
    const lang = this.map[canonical.toLowerCase()];
    if (!lang) return Promise.resolve(undefined);
    if (lang.support) return Promise.resolve(lang.support);
    return lang.load();
  }
}

const loader = new LanguageLoader();

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

class CodeMirrorBlock {
  dom: HTMLElement;
  cm!: CodeMirrorView;

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
  private languageConf: Compartment;
  private readOnlyConf: Compartment;

  constructor(
    node: Node,
    view: PMEditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    this.pmView = view;
    this.getPos = getPos;

    this.languageConf = new Compartment();
    this.readOnlyConf = new Compartment();

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";

    this.previewPanel = document.createElement("div");
    this.previewPanel.className = "code-block-preview";

    this.overlay = document.createElement("div");
    this.overlay.className = "code-block-overlay";

    this.langPicker = new LanguagePicker((name) => {
      this.setLanguage(name);
      this.cm?.focus();
    });
    this.langPicker.value = resolveLang(node.attrs.language ?? "");

    this.copyBtn = document.createElement("button");
    (this.copyBtn as HTMLButtonElement).type = "button";
    this.copyBtn.className = "code-block-copy-btn";
    this.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
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

    this.initializeCodeMirror();
  }

  private initializeCodeMirror() {
    if (this.initialized) return;
    this.initialized = true;

    this.cm = new CodeMirrorView({
      doc: this.node.textContent ?? "",
      root: (this.pmView as any).root as Document | ShadowRoot,
      extensions: [
        basicSetup,
        oneDark,
        keymap.of(defaultKeymap.concat(indentWithTab)),
        this.readOnlyConf.of(EditorState.readOnly.of(!this.pmView.editable)),
        drawSelection(),
        this.languageConf.of([]),
        CodeMirrorView.updateListener.of((update) =>
          this.forwardUpdate(update),
        ),
        keymap.of(this.codeMirrorKeymap()),
      ],
    });

    this.dom.insertBefore(this.cm.dom, this.overlay);
    this.dom.insertBefore(this.previewPanel, this.overlay);
    this.updateLanguage();
    this.cm.focus();
  }

  private forwardUpdate(update: ViewUpdate) {
    if (this.updating || !this.cm.hasFocus) return;
    let offset = (this.getPos() ?? 0) + 1;
    const { main } = update.state.selection;
    const selFrom = offset + main.from;
    const selTo = offset + main.to;
    const pmSel = this.pmView.state.selection;
    if (
      update.docChanged ||
      pmSel.from !== selFrom ||
      pmSel.to !== selTo
    ) {
      const tr = this.pmView.state.tr;
      update.changes.iterChanges(
        (fromA, toA, fromB, toB, text) => {
          if (text.length)
            tr.replaceWith(
              offset + fromA,
              offset + toA,
              this.pmView.state.schema.text(text.toString()),
            );
          else tr.delete(offset + fromA, offset + toA);
          offset += toB - fromB - (toA - fromA);
        },
      );
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
      this.pmView.dispatch(tr);
    }
    if (update.docChanged) {
      this.updatePreview();
    }
  }

  private codeMirrorKeymap() {
    const view = this.pmView;
    return [
      {
        key: "ArrowUp",
        run: () => this.maybeEscape("line", -1),
      },
      {
        key: "ArrowLeft",
        run: () => this.maybeEscape("char", -1),
      },
      {
        key: "ArrowDown",
        run: () => this.maybeEscape("line", 1),
      },
      {
        key: "ArrowRight",
        run: () => this.maybeEscape("char", 1),
      },
      {
        key: "Mod-Enter",
        run: () => {
          if (!exitCode(view.state, view.dispatch)) return false;
          view.focus();
          return true;
        },
      },
      { key: "Mod-z", run: () => undo(view.state, view.dispatch) },
      {
        key: "Shift-Mod-z",
        run: () => redo(view.state, view.dispatch),
      },
      { key: "Mod-y", run: () => redo(view.state, view.dispatch) },
      {
        key: "Backspace",
        run: () => {
          const ranges = this.cm.state.selection.ranges;
          if (ranges.length > 1) return false;
          const selection = ranges[0];
          if (selection && (!selection.empty || selection.anchor > 0))
            return false;
          if (this.cm.state.doc.lines >= 2) return false;
          const state = this.pmView.state;
          const pos = this.getPos() ?? 0;
          const tr = state.tr.replaceWith(
            pos,
            pos + this.node.nodeSize,
            state.schema.nodes.paragraph!.createChecked(
              {},
              this.node.content,
            ),
          );
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          this.pmView.dispatch(tr);
          this.pmView.focus();
          return true;
        },
      },
    ];
  }

  private maybeEscape(unit: "line" | "char", dir: -1 | 1): boolean {
    const { state } = this.cm;
    let main: SelectionRange | Line = state.selection.main;
    if (!main.empty) return false;
    if (unit === "line") main = state.doc.lineAt(main.head);
    if (dir < 0 ? main.from > 0 : main.to < state.doc.length) return false;
    const targetPos =
      (this.getPos() ?? 0) + (dir < 0 ? 0 : this.node.nodeSize);
    const selection = TextSelection.near(
      this.pmView.state.doc.resolve(targetPos),
      dir,
    );
    const tr = this.pmView.state.tr.setSelection(selection).scrollIntoView();
    this.pmView.dispatch(tr);
    this.pmView.focus();
    return true;
  }

  private updatePreview() {
    const isLatex = this.languageName === "LaTeX";
    this.dom.classList.toggle("latex", isLatex);
    if (isLatex) {
      const content = this.cm.state.doc.toString();
      this.previewPanel.innerHTML = renderLatex(content, true);
      this.previewPanel.style.display = "block";
      this.cm.dom.style.borderTop = "1px solid #3b4252";
    } else {
      this.previewPanel.style.display = "none";
      this.cm.dom.style.borderTop = "none";
    }
  }

  private updateLanguage() {
    const languageName = this.node.attrs.language as string | undefined;
    const canonical = resolveLang(languageName ?? "");
    if (canonical === this.languageName) return;
    this.languageName = canonical;
    this.langPicker.value = canonical;
    if (!this.initialized) return;
    this.updatePreview();
    loader.load(canonical).then((lang) => {
      if (!this.initialized) return;
      this.cm.dispatch({
        effects: this.languageConf.reconfigure(lang ?? []),
      });
    });
  }

  setSelection(anchor: number, head: number) {
    if (!this.initialized) this.initializeCodeMirror();
    if (!this.cm.dom.isConnected) return;
    this.cm.focus();
    this.updating = true;
    this.cm.dispatch({ selection: { anchor, head } });
    this.updating = false;
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    if (this.updating) return true;
    this.node = node;
    if (!this.initialized) return true;
    this.updateLanguage();
    if (this.pmView.editable === this.cm.state.readOnly) {
      this.cm.dispatch({
        effects: this.readOnlyConf.reconfigure(
          EditorState.readOnly.of(!this.pmView.editable),
        ),
      });
    }
    const change = computeChange(
      this.cm.state.doc.toString(),
      node.textContent ?? "",
    );
    if (change) {
      this.updating = true;
      this.cm.dispatch({
        changes: { from: change.from, to: change.to, insert: change.text },
        scrollIntoView: true,
      });
      this.updating = false;
    }
    this.updatePreview();
    return true;
  }

  selectNode() {
    if (!this.initialized) this.initializeCodeMirror();
    this.dom.classList.add("selected");
    this.overlay.classList.add("visible");
    this.cm?.focus();
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
      this.cm.destroy();
    }
  }

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
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    this.copyBtn.classList.add("copied");
    setTimeout(() => {
      this.copyBtn.classList.remove("copied");
    }, 1500);
  }
}

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

export const codeBlockUI = $view(
  codeBlockSchema.node,
  (): NodeViewConstructor => (node, view, getPos) =>
    new CodeMirrorBlock(node, view, getPos),
);
