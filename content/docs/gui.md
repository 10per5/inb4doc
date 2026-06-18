---
title: GUI
weight: 15
---

# GUI Architecture

The GUI is a native desktop window that hosts the predoc editor. It is a thin shell — it provides the OS window, loads the editor UI, and bridges JavaScript calls to the local filesystem.

## Operating Modes

The GUI supports two mutually exclusive modes:

**Local mode** — the GUI acts as its own editor server in-process. No external HTTP server is needed, no port is opened, and no special permissions are required. All editor UI requests and content API calls are handled internally via a custom URL scheme (`app://`).

**Remote mode** — the GUI connects to an already-running editor HTTP server. All editor UI and content requests go over HTTP to the specified host and port.

## Interface: `app://` Protocol (Local Mode)

When running in local mode, the GUI intercepts all requests to the `app://` scheme and maps them to the local filesystem:

| URL | Action |
|---|---|
| `app://_/index.html` | Serve `{editor-root}/index.html` |
| `app://_/assets/*` | Serve static files from `{editor-root}/assets/` |
| `app://_/content/<path>` | GET/PUT/DELETE/HEAD on `{content-root}/<path>` |
| `app://_/api/tree` | GET — returns JSON directory tree of `{content-root}` |
| `app://_/api/move` | POST — renames a file or directory within `{content-root}` |

This approach avoids TCP ports, threads, and network permissions — the entire backend runs in-process. The same scheme API is supported across Qt WebEngine, WebKitGTK, WKWebView, and WebView2 backends.

## Interface: CLI Flags

```
predoc-gui --editor-root <path> --content-root <path> [options]
predoc-gui --host <addr> [--port <n>] [options]
```

| Flag | Required | Mode | Description |
|---|---|---|---|
| `--editor-root <path>` | yes* | local | Directory containing `index.html` (the editor web root) |
| `--content-root <path>` | yes* | local | Directory containing markdown content |
| `--host <addr>` | yes* | remote | Editor HTTP server address |
| `--port <n>` | no | remote | Editor HTTP server port (default 3000) |
| `--live-port <n>` | no | both | Live preview server port for the "Preview" JS callback (default 5000) |
| `--favicon <path>` | no | both | Custom window icon |
| `--disable-gpu` | no | both | Disable hardware acceleration |
| `--debug` | no | both | Verbose stderr logging |

\* Exactly one mode must be chosen: `--editor-root` + `--content-root` (local) **or** `--host` ± `--port` (remote). These groups are mutually exclusive.

## Navigation Policy

All navigation and JS bridge calls are subject to a whitelist. Only the following destinations are allowed to load in the webview:

- `app://*` (local mode)
- `http://localhost:*` and `http://127.0.0.1:*` on the live preview port
- New-window navigations to whitelisted destinations are redirected into the existing view

External URLs are blocked and shown in an in-app toast notification.

## JS Bridges

The editor communicates with the host window through named JavaScript callbacks:

| JS Callback | Trigger | Action |
|---|---|---|
| `navigateToEditor()` | User wants to return to editor | Sets webview URL to editor URL |
| `navigateToPreview(path)` | User clicks "Preview" | Sets webview URL to `{live-url}{path}` |
| `handleExternalNav(url)` | Editor wants to open a link | Navigates if whitelisted, shows toast otherwise |

## Window Properties

| Property | Default |
|---|---|
| Title | `"predoc"` |
| Initial size | 1200 × 800 |
| GPU acceleration | On (can be disabled via `--disable-gpu`) |
| Icon | None (optional `--favicon`) |

## License Notes

| Component | License | Linkage |
|---|---|---|
| predoc-gui | MIT | — |
| Saucer | MIT | Static |
| Qt6 (Widgets, WebEngine, WebChannel) | LGPL 3.0 | Dynamic (`.so` at runtime) |

Qt6 is dynamically linked — users get it from their system package manager. This is the standard arrangement for Qt applications and allows free redistribution.
