---
title: Roadmap
weight: 45
---

# Roadmap

## Git Integration

Auto-commit and push before each flush. Snapshot copies before writes would provide undo history beyond the in-memory buffer.

## Single Binary

Embed editor assets and Hugo into the CLI binary for a truly portable single-file executable.

## SSG Pipeline Enhancements

* Flush pending edits from browser buffer to disk before build

* Auto-generate or update `hugo.toml`

* Watch mode: rebuild on content changes

## Platform Support

Saucer supports Qt WebEngine (Linux), WebKitGTK (Linux), WKWebView (macOS), and WebView2 (Windows). The `app://` scheme handler works on all backends — adding macOS/Windows GUI builds is a Dockerfile change.

## Filesystem Mounting

Detect mounted content volumes at startup. A future File System Access API (FSAA) fallback would let the browser read/write local files in environments without a GUI binary.

## Diff-Based Content Updates

The current PUT endpoint sends the entire markdown body on every save. For large documents this is wasteful. A future improvement would use operational transforms (OT) or JSON patches so only the changed portion is transmitted, reducing bandwidth and enabling conflict resolution across clients.

A `maxContentSize` config flag (default ~10 MB) currently rejects oversized PUT bodies at the server — but the real fix is to never send them in the first place.

## Decoupled Server

The server is currently a single-file Bun route handler. Future path toward a deployable, scalable server:

### Phase 1: Extract Router

Move route matching into a small dispatcher. Each route becomes a standalone module (`lib/endpoints/content.ts`, `tree.ts`, `images.ts`, `upload.ts`, `move.ts`), plus `lib/router.ts` and `lib/server-context.ts`.

### Phase 2: OpenAPI Schema

Add an OpenAPI 3.0 spec under `lib/openapi.yaml` for auto-generated client SDKs, request validation middleware, and rendered API docs.

### Phase 3: Pluggable Storage

Replace direct `fs` calls with a `StorageBackend` interface (`read`, `write`, `delete`, `list`, `exists`). Default implementation reads from the local filesystem; alternative backends (S3, SQLite, in-memory) can be injected via `ServerContext`.

### Phase 4: Standalone Server Module

Extract the server into its own package (`server/package.json`) with its own `Dockerfile`. The editor becomes a pure SPA that talks to any server implementing the API contract — deployable to serverless platforms (Cloudflare Workers, Lambda\@Edge) or scaled independently.
