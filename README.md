# inb4doc

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)
[![Sponsors](https://img.shields.io/badge/Sponsors-BECOME%20A%20SPONSOR-ea4aaa?style=for-the-badge\&logo=github-sponsors)](https://github.com/sponsors/10per5)
[![Stars](https://img.shields.io/github/stars/10per5/inb4doc?style=for-the-badge\&logo=github)](https://github.com/10per5/inb4doc/stargazers)

[Live Demo](https://10per5.github.io/inb4doc/editor-live/)

</div>

A markdown wiki with live WYSIWYG editing and static site export via Hugo Book.

## Quick Start

Install the desktop app from the latest release.

* **Linux** (eval from a console):

```bash
curl -fsSL https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.sh | bash
```

* **Windows** (cmd):

```bat
curl.exe -fsSL https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.cmd -o %TEMP%\inb4doc-install.cmd && %TEMP%\inb4doc-install.cmd
```

* **Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.cmd -o $env:TEMP\inb4doc-install.cmd; & $env:TEMP\inb4doc-install.cmd
```

Both installers accept the same options:

| Flag                              | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `--prefix DIR`                    | Install location (default `~/.local/share/inb4doc`, `%LOCALAPPDATA%\Programs\inb4doc`) |
| `--version TAG`                   | Pin a release tag instead of `latest`                                                  |
| `--source URL\|FILE\|DIR`         | Install from a specific URL, archive, or directory                                     |
| `--no-desktop` / `--no-shortcuts` | Skip desktop integration                                                               |
| `--uninstall`                     | Remove the install and desktop entries                                                 |
| `--verify`                        | Launch the app with `--debug` after installing                                         |
| `--help`                          | Show all options                                                                       |

The writable data dir (`~/.local/share/inb4doc` / `%APPDATA%\inb4doc`) is
created by the app on first run.

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

| Command                   | What it does                                   |
| ------------------------- | ---------------------------------------------- |
| `predep`                  | Build everything (main stage = package)        |
| `predep build`            | Build all subprojects (editor, hugo site, GUI) |
| `predep build-docker`     | Build all subprojects via Docker               |
| `predep package`          | Build everything + assemble release archive    |
| `predep editor::build`    | Build editor static files only                 |
| `predep hugo-view::build` | Generate static site only                      |
| `predep gui::build`       | Build native GUI binary only                   |

See `predep/README.md` for full documentation on the stage engine.

## Subproject Manifests

Each subproject declares its own stages in `predep.toml`:

* `editor/predep.toml` — editor build → `editor::build`

* `hugo-view/predep.toml` — Hugo binary, theme, and site generation → `hugo-view::build`

* `gui/predep.toml` — GUI binary build → `gui::build`

* `predep.toml` (root) — parent manifest linking subprojects via `[[include]]`

## Tech Stack

| Layer   | <br />                                |
| ------- | ------------------------------------- |
| Runtime | Bun (editor), C++23 (predep)          |
| Editor  | Milkdown, Hotwired (Stimulus + Turbo) |
| SSG     | Hugo + Book theme                     |
| GUI     | Saucer + Qt6 WebEngine                |
| Content | Plain `.md` files — zero lock-in      |
