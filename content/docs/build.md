---
title: Build
weight: 2
---

# Build

predoc uses [predep](https://github.com/10per5/predep) to orchestrate all build recipes. predep is a self-building tool — it compiles itself and then executes the stages defined in `predep.toml` files throughout the project.

To build everything:

```bash
predep build
```

Or via Docker:

```bash
predep build-docker
```

To assemble a release archive:

```bash
predep package
```

## Build Steps

All build recipes are declared in `predep.toml` at each subproject root:

| Step | Recipe File | Produces |
|---|---|---|
| CLI | [`cli/predep.toml`](https://github.com/10per5/predoc/tree/main/cli/predep.toml) | `cli/bin/predoc` |
| GUI | [`gui/predep.toml`](https://github.com/10per5/predoc/tree/main/gui/predep.toml) | `gui/bin/predoc-gui` |
| Editor JS | [`editor/predep.toml`](https://github.com/10per5/predoc/tree/main/editor/predep.toml) | `editor/public/assets/app.js` |

The root [`predep.toml`](https://github.com/10per5/predoc/blob/main/predep.toml) ties them together via `[[include]]` directives and defines the top-level `build` and `build-docker` stage groups.

Each subproject recipe uses Docker by default and falls back to native tools when available.

### CLI

Uses `cli/Dockerfile` (debian:trixie-slim, premake5 beta8, g++-15). Builds with C++23 and the vendored CLI11 header:

1. `docker build -t predoc-cli cli/`
2. `docker cp <container>:/build/bin/predoc cli/bin/`

Falls back to `premake5 gmake && make` if premake5 is available natively.

### GUI

Uses `gui/Dockerfile` (debian:trixie-slim, Qt6 WebEngine, Saucer built from source):

1. `docker build -t predoc-gui gui/`
2. `docker cp <container>:/build/bin/predoc-gui gui/bin/`

Falls back to native build if premake5 and saucer headers are found at `/usr/local/include/saucer/`.

The Dockerfile is single-stage — the binary is extracted and runs on the host, dynamically linking the host's Qt6 at runtime.

## Build Artifacts

```
cli/bin/predoc                 # ~200KB — CLI binary (statically linked)
gui/bin/predoc-gui             # ~1.2MB — GUI binary (links Qt6 at runtime)
editor/public/assets/app.js  # Editor frontend JS (minified)
editor/public/assets/app.css # Editor frontend CSS (minified)
editor/public/index.html     # Static HTML shell

ssg/
  hugo.toml                  # Hugo configuration
  themes/book/               # Hugo Book theme (downloaded on fetch-deps)
```

These are the only files needed at runtime. Source files (`cli/src/`, `gui/src/`, `editor/src/`) and dev dependencies are not needed on the target machine.
