---
title: Editor
weight: 20
---

# Editor

The editor is a Milkdown v7 WYSIWYG interface loaded inside the native GUI window. All content API calls go through the `app://` scheme handler (in-process, no HTTP server — see [GUI](/docs/gui)).

## Milkdown

[Milkdown](https://milkdown.dev) (v7, 11k+ stars) is the core editor. It's built on ProseMirror + Remark and works with markdown natively — no HTML→MD→HTML roundtrip. Both WYSIWYG and raw markdown source modes are available via toggle.

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

### Markdown Alerts

The editor supports GitHub-style markdown alerts (also known as admonitions):

```markdown
> [!NOTE]
> Useful information that users should know.

> [!TIP]
> Helpful advice for doing things better.

> [!IMPORTANT]
> Key information users need to know.

> [!WARNING]
> Urgent info that needs immediate attention.

> [!CAUTION]
> Advises about risks or negative outcomes.
```

These render as colored callout blocks in the WYSIWYG editor matching the Hugo Book theme's `.book-hint` styling.

### Hugo Shortcodes

Hugo/Book shortcodes (e.g., `{{</* hint info */>}}`, `{{</* details "Summary" */>}}`, `{{</* param "name" */>}}`) are preserved as-is in the markdown source and highlighted as styled badges in the WYSIWYG editor. For a full list of supported shortcodes, see the Hugo Book shortcode reference and Hugo shortcode documentation. Unimplemented shortcodes pass through the editor unchanged.

## Backends

The editor stores plain markdown files. The same files can be processed by supported backends to produce a static site. See the [Backends](/docs/backends) page for details on formatting compatibility per backend.
