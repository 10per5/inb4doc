/// <reference types="bun" />
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
} from "fs"
import { join, extname, dirname } from "path"
import { fileURLToPath } from "url"
import { handleApiRoutes, type ServerContext } from "./endpoints"

const PORT = parseInt(process.env.PORT || "3000", 10)
const HOST = process.env.HOST || "0.0.0.0"
const DISABLE_CONTENT_API =
  process.env.DISABLE_CONTENT_API === "1" ||
  process.env.DISABLE_CONTENT_API === "true"
const NO_IGNORE =
  process.env.NO_IGNORE === "1" || process.env.NO_IGNORE === "true"
const TREE_DEPTH = parseInt(process.env.TREE_DEPTH || "0", 10) || 0

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const EDITOR_DIR = join(SCRIPT_DIR, "..", "public")
const CONTENT_DIR =
  process.env.INB4DOC_CONTENT || join(SCRIPT_DIR, "..", "..", "content")

// The base the editor is served under. This can be a full URL
// (https://site.example/inb4doc/editor-live) or a bare path; for request
// matching we only need the path portion.
const SELF_BASE = (process.env.EDITOR_SELF_BASE || "").replace(/\/+$/, "")
const SELF_BASE_PATH = SELF_BASE
  ? new URL(SELF_BASE, "http://editor.local").pathname.replace(/\/+$/, "")
  : ""
const STATIC_DIR = join(SCRIPT_DIR, "..", "static")

function copyEditorStatic() {
  if (!existsSync(STATIC_DIR)) return
  mkdirSync(EDITOR_DIR, { recursive: true })
  for (const name of readdirSync(STATIC_DIR)) {
    if (name.startsWith(".")) continue
    const src = join(STATIC_DIR, name)
    const dst = join(EDITOR_DIR, name)
    if (statSync(src).isDirectory()) continue
    if (!existsSync(dst)) copyFileSync(src, dst)
  }
}

copyEditorStatic()

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
}

function contentType(path: string): string {
  const ext = extname(path)
  return MIME[ext] || "application/octet-stream"
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

function noCache(res: Response): Response {
  res.headers.set("Cache-Control", "no-cache, must-revalidate")
  return res
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(req.url)
    let path = url.pathname

    if (
      SELF_BASE_PATH &&
      (path === SELF_BASE_PATH || path.startsWith(SELF_BASE_PATH + "/"))
    ) {
      path = path.slice(SELF_BASE_PATH.length) || "/"
    }

    const ctx: ServerContext = {
      contentDir: CONTENT_DIR,
      disableApi: DISABLE_CONTENT_API,
      noIgnore: NO_IGNORE,
      treeDepth: TREE_DEPTH,
    }

    const apiResult = await handleApiRoutes(req, path, ctx)
    if (apiResult) return withCors(apiResult)

    function serveFile(filePath: string): Response | null {
      if (!existsSync(filePath)) return null
      const raw = readFileSync(filePath)
      const ct = contentType(filePath)
      if (ct === "text/html") {
        return noCache(
          new Response(raw.toString("utf-8"), {
            headers: { "Content-Type": ct },
          }),
        )
      }
      return noCache(
        new Response(raw, {
          headers: { "Content-Type": ct },
        }),
      )
    }

    // Fall back to index.html only for extension-less paths (SPA routes). A
    // missing asset (stale chunk, .map file, …) must 404 — serving the shell
    // as 200 HTML breaks import() and DevTools source-map parsing.
    const hasExtension = /\.[a-z0-9]+$/i.test(path)
    const editorPath = join(EDITOR_DIR, path === "/" ? "index.html" : path)
    const result =
      serveFile(editorPath) ||
      (hasExtension ? null : serveFile(join(EDITOR_DIR, "index.html")))
    if (result) return withCors(result)

    return withCors(new Response("Not found", { status: 404 }))
  },
})

console.log(`Editor server → http://${HOST}:${PORT}`)


