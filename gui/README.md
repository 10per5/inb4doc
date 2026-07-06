# inb4doc-gui

Native desktop window built with [Saucer](https://github.com/saucer/saucer)
(C++23) using the WebKitGTK backend (Docker builds) or Qt QWebEngine
backend (native builds on supported distros).

Spawns a window that loads the editor server URL.

## Prerequisites

### Docker (recommended — no host deps)

Docker builds use the WebKitGTK backend on Ubuntu 24.04. The binary
dynamically links WebKitGTK from the host at runtime.

```bash
docker build -t inb4doc-gui gui/
docker create --name tmp inb4doc-gui
docker cp tmp:/build/bin/inb4doc-gui ./gui/bin/
docker rm tmp
```

The resulting binary requires `libwebkitgtk-6.0-4`, `libgtk-4-1`,
`libadwaita-1-0`, and `libsoup-3.0-0` at runtime — typically preinstalled
on Ubuntu 24.04+ GNOME systems.

### Native build

First install [Saucer](https://saucer.github.io/getting-started/) with your
preferred backend, then:

| Distro | WebKitGTK backend | Qt QWebEngine backend |
|--------|-------------------|----------------------|
| Ubuntu 24.04+ | `apt install g++ cmake pkg-config libwebkitgtk-6.0-dev libgtk-4-dev libadwaita-1-dev libsoup-3.0-dev` | Qt 6.7+ needed (not in 24.04 repos) |
| Fedora 39+ | `dnf install gcc-c++ cmake pkgconf webkitgtk6.0-devel gtk4-devel libadwaita-devel libsoup3-devel` | `dnf install gcc-c++ cmake pkgconf qt6-qtbase-devel qt6-qtwebengine-devel` |
| Arch Linux | `pacman -S gcc cmake pkgconf webkitgtk-6.0 gtk4 libadwaita libsoup3` | `pacman -S gcc cmake pkgconf qt6-base qt6-webengine` |

> premake5 may not be in your distro's repos. Download the Linux binary
> from https://premake.github.io/download and put it in your PATH.

```bash
cd gui
premake5 gmake
make -C build config=release -j"$(nproc)"
```

The binary dynamically links the backend libraries (WebKitGTK or Qt6) at
runtime — no static bundling.

### macOS / Windows

See https://saucer.github.io/getting-started/ for backend setup per platform.

```bash
brew install premake5 qt@6          # macOS
premake5 gmake && make -C build config=release
```

## Run

```bash
./bin/inb4doc-gui --port 3000
```

## License

MIT (same as inb4doc). Saucer is MIT. WebKitGTK (LGPL) and Qt6 (LGPL) are
dynamically linked — no redistribution restrictions.
