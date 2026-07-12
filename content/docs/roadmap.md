---
title: Roadmap
weight: 45
---

# Roadmap

## Git Integration

Streamline a way to commit directly from editor or start a PR to a repository, using the editor contents.

## Diff-Based Content Updates

The current PUT endpoint sends the entire markdown body on every save. For large documents this is wasteful. A future improvement would use operational transforms (OT) or JSON patches so only the changed portion is transmitted, reducing bandwidth and enabling conflict resolution across clients.

A `maxContentSize` config flag (default ~10 MB) currently rejects oversized PUT bodies at the server — but the real fix is to never send them in the first place.

## AI integration — Concept (ObservableHQ / Jupyter-style)

- `/` invokes a command palette that includes an "AI generate" option
- Opens a prompt input box (like Crepe's `AIInstructionTooltip`) where user describes what they want
- AI generates markdown content and inserts it into the editor at cursor
- **Future considerations:**
  - Cell-based interface (like ObservableHQ where each block is a cell)
  - Multi-provider support (OpenAI, Anthropic, local)
  - Streaming response with diff review (accept/reject)
  - Potential integration with `/` menu for "Improve writing", "Fix grammar", "Continue", "Summarize"
  - Prompt history and favorites
- Not started — needs separate discussion and scoping

## Decoupled Server

The server is currently a single-file Bun route handler. Future path toward a deployable, scalable server:

### Phase 1: Extract Router

Move route matching into a small dispatcher. Each route becomes a standalone module (`lib/endpoints/content.ts`, `tree.ts`, `images.ts`, `upload.ts`, `move.ts`), plus `lib/router.ts` and `lib/server-context.ts`.

### Phase 2: OpenAPI Schema

Add an OpenAPI 3.0 spec under `lib/openapi.yaml` for auto-generated client SDKs, request validation middleware, and rendered API docs.

### Phase 3: Pluggable Storage

Replace direct `fs` calls with a `StorageBackend` interface (`read`, `write`, `delete`, `list`, `exists`). Default implementation reads from the local filesystem; alternative backends (S3, SQLite, in-memory) can be injected via `ServerContext`.

### Phase 4: Standalone Server Module

Extract the server into its own package (`server/package.json`) with its own `Dockerfile`. The editor becomes a pure SPA that talks to any server implementing the API contract — deployable to serverless platforms (Cloudflare Workers, Lambda@Edge) or scaled independently.

## Touch Gestures (Mobile)

| Gesture                   | Action                            |
| ------------------------- | --------------------------------- |
| Swipe from left edge      | Open sidebar                      |
| Swipe from right edge     | Open meta-panel                   |
| Long-press on block       | Select for drag                   |
| Swipe left/right on block | Quick actions (delete, duplicate) |
