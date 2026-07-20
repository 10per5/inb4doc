---
title: Getting Started
weight: 1
---

# Getting Started

![1.00](/docs/image/image-0he7dh.png)

## Prerequisites

- [Docker](https://docs.docker.com/engine/install/) — primary build method

- Or [premake5](https://premake.github.io/download) + C++23 compiler + Qt6 + Saucer for native builds

Hugo and the Book theme are downloaded automatically by `inb4doc fetch-deps`.

## Quick Start

Builds are orchestrated by [predep](https://github.com/10per5/predep), which compiles itself from source and follows the recipes in [`predep.toml`](https://github.com/10per5/inb4doc/blob/main/predep.toml) files throughout the project.

```bash
# Build CLI + GUI + Editor JS
predep build

# Or build via Docker
predep build-docker

# Launch the editor
inb4doc $PATH_TO_CONTENT
```

## Build Steps

All build recipes are declared in `predep.toml` at each subproject root, the root [`predep.toml`](https://github.com/10per5/inb4doc/blob/main/predep.toml) ties them together via `[[include]]` directives and defines the top-level `build` and `build-docker` stage groups.

### Build Artifacts

```
gui/bin/inb4doc-gui          # ~1.2MB — GUI binary (links Qt6 at runtime)
editor/public/assets/app.js  # Editor frontend JS (minified)
editor/public/assets/app.css # Editor frontend CSS (minified)
editor/public/index.html     # Static HTML shell
```

These are the only files needed at runtime. Source files (`gui/src/`, `editor/src/`) and dev dependencies are not needed on the target machine.
