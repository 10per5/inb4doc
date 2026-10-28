/**
 * details — node view for the collapsible `<details>` block.
 *
 * The node's `title` attr is the `<summary>` text and `open` mirrors the HTML
 * attribute. Both live in node attrs (there is no child node for the summary),
 * so toggling is a `setNodeMarkup` transaction rather than a DOM mutation —
 * otherwise ProseMirror would re-render from the doc and the panel would snap
 * back on the next state update.
 */

import { defineNodeView } from "@prosekit/core";
import type { NodeView, ViewMutationRecord } from "prosemirror-view";

export const detailsView = defineNodeView({
  name: "details",
  constructor: (node, view, getPos): NodeView => {
    const dom = document.createElement("details");
    dom.className = "md-details";
    dom.dataset.type = "details";

    const summary = document.createElement("summary");
    summary.className = "md-details-summary";
    summary.contentEditable = "true";
    summary.spellcheck = false;

    const body = document.createElement("div");
    body.className = "md-details-body";

    dom.append(summary, body);

    let syncing = false;

    const sync = (attrs: Record<string, any>) => {
      syncing = true;
      const title = String(attrs.title ?? "");
      // Keep a non-empty accessible label even before the user names it.
      if (summary.textContent !== title) summary.textContent = title;
      summary.classList.toggle("is-empty", title.trim() === "");
      dom.open = Boolean(attrs.open);
      dom.classList.toggle("md-details-open", Boolean(attrs.open));
      syncing = false;
    };

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

    sync(node.attrs as Record<string, any>);

    // Toggling the panel must not go through the browser's own summary
    // behaviour — the doc is the source of truth, so intercept the click and
    // flip the attr instead.
    summary.addEventListener("click", (e) => {
      e.preventDefault();
      writeAttrs({ open: !dom.open });
    });

    summary.addEventListener("keydown", (e) => {
      // Enter inside the summary would otherwise start a new block.
      if (e.key === "Enter") {
        e.preventDefault();
        (e.currentTarget as HTMLElement).blur();
      }
    });

    summary.addEventListener("blur", () => {
      if (syncing) return;
      const next = (summary.textContent ?? "").trim();
      const pos = getPos();
      const current = pos == null ? undefined : view.state.doc.nodeAt(pos);
      if (!current) return;
      if (String(current.attrs.title ?? "") === next) return;
      writeAttrs({ title: next });
    });

    return {
      dom,
      contentDOM: body,
      update: (updated) => {
        if (updated.type.name !== "details") return false;
        sync(updated.attrs as Record<string, any>);
        return true;
      },
      ignoreMutation: (record: ViewMutationRecord) =>
        record.target === summary || summary.contains(record.target as Node),
    };
  },
});
