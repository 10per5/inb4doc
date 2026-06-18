---
title: Getting Started
weight: 1
---

# Getting Started

## Prerequisites

- [Docker](https://docs.docker.com/engine/install/) — primary build method
- Or [premake5](https://premake.github.io/download) + C++23 compiler + Qt6 + Saucer for native builds

Hugo and the Book theme are downloaded automatically by `predoc fetch-deps`.

## Quick Start

Builds are orchestrated by [predep](https://github.com/10per5/predep), which compiles itself from source and follows the recipes in [`predep.toml`](https://github.com/10per5/predoc/blob/main/predep.toml) files throughout the project.

```bash
# Build CLI + GUI + Editor JS
predep build

# Or build via Docker
predep build-docker

# Launch the editor
cli/bin/predoc

# With debug logging
cli/bin/predoc --debug
```

## Commands

| Command                  | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `predoc` (no subcommand) | Launch the native GUI window with the editor      |
| `predoc --debug`         | Same, with verbose debug output                   |
| `predoc fetch-deps`      | Download Hugo binary + Book theme to cache        |
| `predoc package`         | Build editor assets + GUI binary, assemble output |

## Content

predoc reads and writes markdown from the `content/` directory. The directory tree is the page hierarchy — `content/docs/foo.md` appears as `/docs/foo` in the editor.

The home page is `content/_index.md`. When the editor loads with no specific path, it defaults to `_index` and displays it as "Home" in the sidebar.
