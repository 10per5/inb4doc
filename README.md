# inb4doc

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)
[![Sponsors](https://img.shields.io/badge/Sponsors-BECOME%20A%20SPONSOR-ea4aaa?style=for-the-badge&logo=github-sponsors)](https://github.com/sponsors/10per5)
[![Stars](https://img.shields.io/github/stars/10per5/inb4doc?style=for-the-badge&logo=github)](https://github.com/10per5/inb4doc/stargazers)

[Live Demo](https://10per5.github.io/inb4doc/)

</div>

A markdown wiki with live WYSIWYG editing and static site export via Hugo Book.

## Quick Start

```bash
# Build editor assets (bun → npm → Docker)
predep editor::editor-assets

# Live editor with inline markdown editing
cd editor && bun dev

# Generate static site
predep hugo-view::hugo-build

# Serve the static site
cd hugo-view && python3 -m http.server -d build 8080
```

Hugo and the Book theme are downloaded automatically on first build by predep.

## Git Hooks

Pre-push hooks validate predep SHAs and package versions. Enable once after cloning:

```bash
git config core.hooksPath .githooks
```

## How it Works

Two layers that share the same `content/` directory:

**Editor** — A local server with a WYSIWYG editor (Milkdown + ProseMirror) and
raw markdown mode. Filesystem is the source of truth: directories map to the
page tree, edits write directly to `.md` files. Run with `editor:dev`.

**SSG** — Runs Hugo with the Book theme to generate a static site. Deploy
anywhere (GitHub Pages, Surge, Netlify, etc.). Generate with `predep hugo-fetch`.

## Build System

All build orchestration uses `predep`, the stage-processing engine:

| Command                        | What it does                                   |
| ------------------------------ | ---------------------------------------------- |
| `predep`                       | Build everything (main stage = package)        |
| `predep build`                 | Build all subprojects (editor, hugo site, GUI) |
| `predep build-docker`          | Build all subprojects via Docker               |
| `predep package`               | Build everything + assemble release archive    |
| `predep editor::editor-assets` | Build editor static files only                 |
| `predep hugo-view::hugo-build` | Generate static site only                      |
| `predep gui::gui-binary`       | Build native GUI binary only                   |

See `predep/README.md` for full documentation on the stage engine.

## Subproject Manifests

Each subproject declares its own stages in `predep.toml`:

- `editor/predep.toml` — editor build (bun/npm/Docker auto-detect) → `editor::editor-assets`
- `hugo-view/predep.toml` — Hugo binary, theme, and site generation → `hugo-view::hugo-build`
- `gui/predep.toml` — GUI binary build → `gui::gui-binary`
- `predep.toml` (root) — parent manifest linking subprojects via `[[include]]`

## Tech Stack

| Layer   |                                       |
| ------- | ------------------------------------- |
| Runtime | Bun (editor), C++23 (predep)          |
| Editor  | Milkdown, Hotwired (Stimulus + Turbo) |
| SSG     | Hugo + Book theme                     |
| GUI     | Saucer + Qt6 WebEngine                |
| Content | Plain `.md` files — zero lock-in      |
