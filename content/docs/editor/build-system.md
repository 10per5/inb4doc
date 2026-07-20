---
title: Build System
weight: 30
---

# Build System

Conditional compilation via `BUILD_MODE` env var and runtime `AppFunc` feature flags.

## Modes

| Mode | Target | Default provider | Network probe on startup |
|------|--------|------------------|---------------------------|
| `web-remote` | Static host (GitHub Pages) | `localStorage` | Blocked |
| `web-local` | Dev / self-hosted (localhost) | `remote` | Allowed |
| `gui-desktop` | Linux/macOS/Windows desktop | `remote` (app:// fallback) | Allowed |
| `gui-mobile` | Android / tablet WebView | `remote` (app:// fallback) | Allowed |

## Feature flags (`AppFunc` bitmask)

Each mode enables a different set of features:
- `AllowProbe` — permits outgoing `localhost` probe on startup
- `DefaultToRemote` — provider init tries `remote` before `localStorage`
- `MobileCss` — bundles `mobile.css`
- `ToolbarMobile` — renders sidebar/meta toggle buttons
- `SidebarGestures` — lazy-loads swipe/drag handlers
- `MetaPanelCompact` — compact meta panel layout
- `DevOverlay` — dev-only diagnostics
- `LivePreview` — shows live preview link in sidebar

## Files

- `editor/lib/interpolate.ts` — injects `__BUILD_MODE__` into `<html data-build-mode="...">`
- `editor/build.ts` — sets `BUILD_MODE` env (default `web-local`)
- `editor/src/lib/build-mode.ts` — runtime `BuildMode` enum + `hasFunc(AppFunc)` lookup
- `editor/src/styles/mobile.css` — mobile-only overrides (conditionally imported)

## Rollout

1. Build mode flag + interpolation (done)
2. Gate provider init / probe / toolbar / CSS (done)
3. Add GitHub Actions matrix for `build-mode`
4. Wire APK build step to use `BUILD_MODE=gui-mobile`
