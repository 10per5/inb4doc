---
title: Backends
weight: 30
---

# Backends

The editor stores plain markdown files in `content/`. The same files can be processed by supported backends to produce a static site. Currently, the only supported backend is **Hugo + Book theme**.

## Hugo + Book Theme

The SSG layer converts markdown content into a fully static HTML site using [Hugo](https://gohugo.io) and the [Book theme](https://github.com/alex-shpak/hugo-book) by Alex Shpak (MIT).

### Why Hugo

Hugo is the most popular static site generator — mature, fast (sub-second builds), and distributed as a single binary. No runtime dependencies.

### Why Book Theme

The [Hugo Book theme](https://themes.gohugo.io/themes/hugo-book/) (\~4k stars, MIT) is built for documentation:

* Clean, minimal, mobile-friendly design

* Works without JavaScript

* Dark mode, search, multi-language support

* Useful shortcodes: hints, tabs, expand/collapse, mermaid diagrams

### Supported Formatting

| Feature                                                      | Editor                   | Hugo + Book           |
| ------------------------------------------------------------ | ------------------------ | --------------------- |
| CommonMark                                                   | ✅                        | ✅                     |
| GFM (tables, strikethrough, task lists)                      | ✅                        | ✅                     |
| [Markdown alerts](/docs/style/markdown-alerts) (`> [!NOTE]`) | ✅ styled callout         | ✅ via `book-hint` CSS |
| [Hugo shortcodes](/docs/style/shortcodes) (`{{</* … */>}}`)  | 🔶 highlighted as badges | ✅ full rendering      |

For unimplemented shortcodes, the raw `{{</* … */>}}` syntax is preserved in the markdown source and highlighted as a badge in the editor. The Hugo build processes them correctly.

### Dependencies

`inb4doc fetch-deps` downloads:

* **Hugo** → `~/.cache/inb4doc/bin/hugo` (auto-detected on PATH)

* **Book theme** → `ssg/themes/book/`

Both are downloaded on first use if missing.

### Build

```bash
# Manual Hugo build
cd ssg
hugo --source . \
     --contentDir ../content \
     --themesDir themes \
     --theme book \
     --destination build

# Or via the SSG CLI
inb4doc package
```

Output: `ssg/build/` — a portable static site compatible with GitHub Pages, Netlify, Surge, Vercel, or plain S3.

## See Also

- [MkDocs](https://www.mkdocs.org/) — a Python-based static site generator similar in spirit to this Hugo backend. See the [alternatives page](/docs/3rd-party/alternatives#mkdocs) for a comparison.
