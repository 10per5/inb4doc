---
title: Endpoints
weight: 40
---

# Endpoints

The editor communicates with the server (or GUI in-process handler) through a small set of HTTP-like API routes. All routes are defined in a single file — `editor/lib/endpoints.ts` — and dispatched through a single `handleApiRoutes` function.

## Current Architecture

The server is a single-file Bun module with no framework, no database, and no middleware. Routes are matched by string prefix and HTTP method. The entire surface is:

| Method     | Route                           | Handler             | Purpose                     |
| ---------- | ------------------------------- | ------------------- | --------------------------- |
| GET / HEAD | `/content/<path>`               | `handleContent`     | Read a markdown file        |
| PUT        | `/content/<path>`               | `handleContent`     | Write a markdown file       |
| DELETE     | `/content/<path>`               | `handleContent`     | Delete a markdown file      |
| GET        | `/api/tree`                     | `handleTree`        | List content directory tree |
| POST       | `/api/move`                     | `handleMove`        | Rename / move a file        |
| POST       | `/api/upload`                   | `handleUpload`      | Upload an image             |
| GET        | `/uploads/<path>`               | `handleUploads`     | Serve uploaded files        |
| GET        | `/api/images?dir=<d>&refs=true` | `handleListImages`  | List images in a doc dir    |
| DELETE     | `/api/images/<name>?dir=<d>`    | `handleDeleteImage` | Delete an image             |

## Endpoint Reference

### Content CRUD

**`GET /content/<path>`** — Read a markdown file. Appends `.md` if no extension is present. Returns `404` if the file doesn't exist. `HEAD` returns status without body.

**`PUT /content/<path>`** — Write a markdown file. Creates parent directories as needed. Expects raw markdown in request body.

**`DELETE /content/<path>`** — Delete a markdown file. Also removes empty parent directories up to `contentDir`. Returns `404` if not found.

All content paths are relative to `contentDir`. Paths that don't end in `.md` (after `.md` is appended) are rejected with `404`.

### Directory Tree

**`GET /api/tree`** — Returns a JSON tree of the `contentDir` directory:

```json
{
  "_index.md": null,
  "docs": {
    "getting-started.md": { "weight": 1 },
    "architecture.md": { "weight": 10 },
    "editor.md": { "weight": 20 }
  }
}
```

* Directories are objects with file entries as keys

* Files with YAML `weight:` frontmatter get `{ "weight": <n> }`, otherwise `null`

* Hidden files (`.` prefix) are excluded

* `.gitignore` patterns are respected (skippable via `noIgnore`)

### Move / Rename

**`POST /api/move`** — Move a file from one path to another:

```json
{ "from": "docs/old.md", "to": "docs/new.md" }
```

* Returns `404` if source doesn't exist, `409` if destination exists

* Empty source directories are cleaned up after the move

### Image Upload

**`POST /api/upload`** — Multipart form upload with fields `file` (binary) and `dir` (optional document directory):

| Field  | Type            | Required | Description                                 |
| ------ | --------------- | -------- | ------------------------------------------- |
| `file` | `File` (binary) | Yes      | The image file                              |
| `dir`  | string          | No       | Document subdirectory (e.g., `docs/guides`) |

Response:

```json
{ "url": "image/my-photo-a1b2c3.png" }
```

URL format:

* With `dir`: `image/<name>` (relative, resolved by the editor's `proxyDomURL`)

* Without `dir`: `/uploads/image/<name>` (absolute, served by the server)

Filenames are sanitized: lowercased, non-alphanumeric → hyphens, truncated to 40 chars, appended with a random 6-char suffix. Only `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `bmp`, `ico` extensions are accepted (others default to `.png`).

### Image Serving

**`GET /uploads/<path>`** — Serve files from `contentDir/<path>`:

| URL                           | Serves from                       |
| ----------------------------- | --------------------------------- |
| `/uploads/image/foo.png`      | `{contentDir}/image/foo.png`      |
| `/uploads/docs/image/foo.png` | `{contentDir}/docs/image/foo.png` |

This is the only route that serves binary files. MIME types are determined by file extension.

### Image Listing

**`GET /api/images?dir=<docDir>&refs=true`** — List all images in a document directory's `image/` subfolder:

| Param  | Type    | Default | Description                                |
| ------ | ------- | ------- | ------------------------------------------ |
| `dir`  | string  | `""`    | Document directory to scan                 |
| `refs` | boolean | `false` | When true, scan `.md` files for references |

Response:

```json
{
  "images": [
    { "name": "foo-a1b2c3.png", "url": "/uploads/docs/image/foo-a1b2c3.png", "usedIn": ["docs/page.md"] }
  ]
}
```

The reference scan (`refs=true`) searches `.md` files in the given directory for the image filename string — it's a simple substring match, not AST-aware.

### Image Delete

**`DELETE /api/images/<name>?dir=<docDir>`** — Delete an image file from the filesystem. Returns `404` if not found.

## Adding a New Endpoint

1. Write a handler function in `editor/lib/endpoints.ts` — a plain function accepting `(req, ctx)` and returning `Response | null`
2. Add a route match in `handleApiRoutes` for the path and method
3. If the endpoint needs new data from the client, implement the corresponding method in each content provider (`remote-provider.ts`, `fs-provider.ts`, `local-storage-provider.ts`)

### Conventions

* Return `null` for unhandled paths so the caller can fall through to static files or 404

* Error status codes: `400` bad input, `404` not found, `409` conflict, `405` wrong method

* Always join paths with `join(ctx.contentDir, ...)` to prevent directory traversal

* Zero npm dependencies — use `req.json()` and `req.formData()` from the Web API, `fs` and `path` from the runtime
