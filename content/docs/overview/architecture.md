---
title: Architecture
weight: 10
---

# Architecture

inb4doc is composed of four independent layers that share a single `content/` directory of plain markdown files.

## Layers

**Editor** — A Milkdown v7 WYSIWYG interface (Turbo + Stimulus). Loads and saves content via HTTP API calls (`GET/PUT/DELETE /content/*`, `GET /api/tree`, `POST /api/move`). The editor frontend is a static SPA — HTML + JS + CSS — with no server logic of its own.

**GUI** — A native C++23 desktop window (Saucer + Qt6 WebEngine / WebKitGTK / WKWebView / WebView2) that hosts the editor. Serves editor files and handles content API calls entirely in-process via a custom `app://` URL scheme handler — no TCP server, no database, no port.

**SSG** — Runs [Hugo](https://gohugo.io) with the [Book theme](https://github.com/alex-shpak/hugo-book) to produce a static site into `build/`. Hugo and the theme are downloaded automatically by `inb4doc fetch-deps`.

## Why Plain Markdown

No database, no lock-in. The directory tree is the page hierarchy. `content/docs/advanced/config.md` → `/docs/advanced/config`. Stop using the app and you keep your docs.

## Technology Stack

| Layer      | Choice                             | Why                                                               |
| ---------- | ---------------------------------- | ----------------------------------------------------------------- |
| GUI        | Saucer + Qt6 WebEngine / WebKitGTK | Cross-platform native window, embedded Chromium/WebKit            |
| Editor     | Milkdown v7                        | ProseMirror + Remark, WYSIWYG and MD source, no HTML↔MD roundtrip |
| Navigation | Hotwired (Turbo + Stimulus)        | HTML-over-wire, progressive enhancement, \~28KB gzip              |
| SSG        | Hugo + Book theme                  | Fastest SSG, mature ecosystem, clean docs output                  |
| Content    | Plain `.md`                        | Portable, version-controllable, zero lock-in                      |
