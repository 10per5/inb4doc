---
title: Editor
weight: 20
---

# Editor

The editor is a Milkdown v7 WYSIWYG interface loaded inside the native GUI window. All content API calls go through the `app://` scheme handler (in-process, no HTTP server — see [GUI](/docs/gui)).

## Milkdown

[Milkdown](https://milkdown.dev) (v7, 11k+ stars) is the core editor. It's built on ProseMirror + Remark and works with markdown natively — no HTML→MD→HTML roundtrip. Both WYSIWYG and raw markdown source modes are available via toggle.

inb4doc's plugin surface is intentionally small, but Milkdown and ProseMirror have a large [plugin ecosystem](https://github.com/artemnistuley/awesome-prosemirror) — individual maintainers or forks can implement custom behavior through ProseMirror plugins or Milkdown prosemirror plugins.

## Hotwired (Turbo + Stimulus)

Navigation and interaction use [Hotwired](https://hotwired.dev):

* **Turbo Drive** — SPA-like navigation without client-side routing

* **Turbo Frames** — Inline editing without hand-coded fetch calls

* **Stimulus** — Tiny controllers for editor mount/unmount, mode toggle, save buffer, flush

Combined bundle: **\~28KB gzip**.

## Flush-Based Writes

Edits accumulate in an in-memory buffer + IndexedDB (crash recovery). The filesystem is only touched on explicit "Flush" or page navigation. This prevents partial writes and reduces I/O.

## Initial Page

When the editor loads at the root URL (`/`), it defaults to `content/_index.md` (the home page). `_index.md` is displayed as "Home" in the sidebar and maps to the `/` URL path.

## Supported Formatting

The editor supports full **CommonMark** and **GitHub Flavored Markdown** (GFM), including tables, strikethrough, task lists, and auto-links.

## Command Menu (/)

Triggered by typing `/` or via the **+** button in the toolbar.

* Available on all viewports

* Inserts blocks (headings, lists, code, images, etc.)

* **Mobile**: menu adapts to screen width, larger touch targets, positioned to avoid keyboard overlap

## @ Mentions

Triggered by typing `@` in the editor.

* Available on all viewports

* Searches and links to other pages in the project

* **Mobile**: menu height limited to avoid keyboard overlap

## See Also

- [Superdoc](https://github.com/superdoc-dev/superdoc) — a modern collaborative DOCX editor. Too heavy for this project ([5.79 MB build](https://sizepanic.com/package/superdoc), [113 MB deps](https://pkg-size.dev/superdoc)), but a nice option if full Office-style editing is needed.
- [Quill](https://github.com/slab/quill) — a modern rich text editor built for compatibility and extensibility. A lighter-weight alternative if a simpler WYSIWYG is acceptable.
- [Tiptap](https://tiptap.dev/) — a headless, customizable editor framework built on ProseMirror, well suited for custom editing experiences.
