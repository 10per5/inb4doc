/**
 * details — node view for the collapsible `<details>` block.
 *
 * The node's `title` attr is the `<summary>` text and `open` mirrors the HTML
 * attribute. Both live in node attrs (there is no child node for the summary),
 * so toggling is a `setNodeMarkup` transaction rather than a DOM mutation —
 * otherwise ProseMirror would re-render from the doc and the panel would snap
 * back on the next state update.
 *
 * Renaming replaces the title span with a real `<input>` for as long as the
 * edit lasts. An always-contenteditable summary cannot work here: ProseMirror
 * owns contenteditable inside the editor (it resets it on every re-render and
 * treats keypresses as caret moves), and the same click that would place the
 * caret also toggles the panel.
 */

import { defineNodeView } from "@prosekit/core";
import type { NodeView, ViewMutationRecord } from "prosemirror-view";
import { editPencil } from "@/eta/icons";

export const detailsView = defineNodeView({
  name: "details",
  constructor: (node, view, getPos): NodeView => {
    const dom = document.createElement("details");
    dom.className = "md-details";
    dom.dataset.type = "details";

    const summary = document.createElement("summary");
    summary.className = "md-details-summary";
    summary.title = "Toggle section";
    // The summary sits inside the editor's contenteditable surface but is NOT
    // content (there is no node for it), so it must opt out explicitly —
    // otherwise the caret lands in it and typing edits a label that never
    // reaches the doc. Renaming goes through the pencil/`<input>` only.
    summary.contentEditable = "false";

    const titleEl = document.createElement("span");
    titleEl.className = "md-details-title";
    titleEl.contentEditable = "false";

    // An explicit control, not a gesture: double-click fought the toggle (its
    // first click already flipped the panel), so renaming starts here.
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "md-details-rename";
    renameBtn.title = "Rename section";
    renameBtn.setAttribute("aria-label", "Rename section");
    renameBtn.innerHTML = editPencil;

    summary.append(titleEl, renameBtn);

    const body = document.createElement("div");
    body.className = "md-details-body";
    dom.append(summary, body);

    let editing = false;
    let attrs = node.attrs as Record<string, any>;
    let input: HTMLInputElement | null = null;
    let actions: HTMLElement | null = null;

    const writeAttrs = (patch: Record<string, any>) => {
      const pos = getPos();
      if (pos == null) return;
      const target = view.state.doc.nodeAt(pos);
      if (!target || target.type.name !== "details") return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...target.attrs,
          ...patch,
        }),
      );
    };

    const sync = (next: Record<string, any>, keepText = false) => {
      attrs = next;
      const title = String(next.title ?? "");
      // While renaming the `<input>` owns the text — writing the span would
      // drop keystrokes (any unrelated transaction runs this).
      if (!keepText) titleEl.textContent = title;
      // The placeholder ("Details") belongs to the label, so it must never be
      // left on while the input shows a real (possibly empty) value.
      summary.classList.toggle("is-empty", !editing && title.trim() === "");
      dom.open = Boolean(next.open);
      dom.classList.toggle("md-details-open", Boolean(next.open));
    };

    const endEdit = (commitValue: string | null) => {
      if (!editing) return;
      editing = false;
      const next = commitValue?.trim() ?? null;
      summary.classList.remove("is-editing");
      input?.remove();
      input = null;
      actions?.remove();
      actions = null;
      renameBtn.hidden = false;
      if (next !== null && next !== String(attrs.title ?? "")) {
        attrs = { ...attrs, title: next };
        writeAttrs({ title: next });
      }
      sync(attrs);
    };

    /**
     * A small text-only action (Save / Cancel). Mousedown is cancelled so the
     * click never blurs the input first — blur commits, which would save the
     * very edit the Cancel button is meant to throw away.
     */
    const actionButton = (label: string, onClick: () => void) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `md-details-rename-action md-details-rename-${label.toLowerCase()}`;
      el.textContent = label;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return el;
    };

    const beginEdit = () => {
      if (editing) return;
      editing = true;
      summary.classList.add("is-editing");
      input = document.createElement("input");
      input.type = "text";
      input.className = "md-details-title-input";
      input.value = String(attrs.title ?? "");
      input.placeholder = "Section title";
      input.setAttribute("aria-label", "Section title");

      // The pencil is replaced by the two actions for as long as the edit
      // lasts — one obvious affordance at a time.
      renameBtn.hidden = true;
      actions = document.createElement("span");
      actions.className = "md-details-rename-actions";
      actions.append(
        actionButton("Save", () => endEdit(input?.value ?? null)),
        actionButton("Cancel", () => endEdit(null)),
      );

      summary.insertBefore(input, renameBtn);
      summary.insertBefore(actions, renameBtn);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          endEdit(input?.value ?? null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          endEdit(null);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          // Select-all while renaming belongs to the field: let it through and
          // it selects every block in the document (and PM, which ignores this
          // input, paints no selection for it).
          e.preventDefault();
          e.stopPropagation();
          input?.select();
        }
      });
      input.addEventListener("blur", () => endEdit(input?.value ?? null));
      input.focus();
      input.select();
    };

    sync(node.attrs as Record<string, any>);

    // Toggling must not go through the browser's own summary behaviour — the
    // doc is the source of truth, so intercept the click and flip the attr.
    // The rename button and the input stop propagation before it reaches here.
    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (editing) return;
      writeAttrs({ open: !dom.open });
    });

    renameBtn.addEventListener("mousedown", (e) => {
      // Keep the click out of ProseMirror: it would move the caret/selection.
      e.preventDefault();
      e.stopPropagation();
    });

    renameBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginEdit();
    });

    return {
      dom,
      contentDOM: body,
      update: (updated) => {
        if (updated.type.name !== "details") return false;
        // While renaming, the input holds the pending value: re-syncing from
        // the doc would drop keystrokes (any unrelated transaction triggers
        // this), so only the attrs are remembered.
        if (editing) sync(updated.attrs as Record<string, any>, true);
        else sync(updated.attrs as Record<string, any>);
        return true;
      },
      // While renaming, keystrokes and clicks belong to the input, not to the
      // document — otherwise every letter becomes an edit in the body.
      stopEvent: (event) => {
        const target = event.target as Node | null;
        if (!editing || !input || !target) return false;
        return target === input;
      },
      ignoreMutation: (record: ViewMutationRecord) =>
        record.target === summary || summary.contains(record.target as Node),
      destroy: () => {
        input?.remove();
        input = null;
      },
    };
  },
});
