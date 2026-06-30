/// <reference types="bun" />
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from "fs";
import { join, extname, dirname } from "path";
import { interpolateHtml } from "./lib/interpolate";
import { handleApiRoutes, type ServerContext } from "./lib/endpoints";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DISABLE_CONTENT_API = process.env.DISABLE_CONTENT_API === "1" || process.env.DISABLE_CONTENT_API === "true";
const NO_IGNORE = process.env.NO_IGNORE === "1" || process.env.NO_IGNORE === "true";
const TREE_DEPTH = parseInt(process.env.TREE_DEPTH || "0", 10) || 0;

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const EDITOR_DIR = join(SCRIPT_DIR, "public");
const CONTENT_DIR = process.env.PREDOC_CONTENT || join(SCRIPT_DIR, "..", "content");

const SELF_BASE = (process.env.EDITOR_SELF_BASE || "").replace(/\/+$/, "");

const STATIC_DIR = join(SCRIPT_DIR, "static");

function copyEditorStatic() {
  if (!existsSync(STATIC_DIR)) return;
  mkdirSync(EDITOR_DIR, { recursive: true });
  for (const name of readdirSync(STATIC_DIR)) {
    if (name.startsWith(".")) continue;
    const src = join(STATIC_DIR, name);
    const dst = join(EDITOR_DIR, name);
    if (statSync(src).isDirectory()) continue;
    if (!existsSync(dst)) copyFileSync(src, dst);
  }
}

copyEditorStatic();

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function contentType(path: string): string {
  const ext = extname(path);
  return MIME[ext] || "application/octet-stream";
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let path = url.pathname;

    if (SELF_BASE && path.startsWith(SELF_BASE)) {
      path = path.slice(SELF_BASE.length) || "/";
    }

    const ctx: ServerContext = {
      contentDir: CONTENT_DIR,
      disableApi: DISABLE_CONTENT_API,
      noIgnore: NO_IGNORE,
      treeDepth: TREE_DEPTH,
    };

    const apiResult = await handleApiRoutes(req, path, ctx);
    if (apiResult) return apiResult;

    function metaInject(html: string): string {
      return interpolateHtml(html);
    }

    function serveFile(filePath: string): Response | null {
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath);
      const ct = contentType(filePath);
      if (ct === "text/html") {
        return new Response(metaInject(raw.toString("utf-8")), {
          headers: { "Content-Type": ct },
        });
      }
      return new Response(raw, {
        headers: { "Content-Type": ct },
      });
    }

    const editorPath = join(EDITOR_DIR, path === "/" ? "index.html" : path);
    const result = serveFile(editorPath) || serveFile(join(EDITOR_DIR, "index.html"));
    if (result) return result;

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Editor server → http://${HOST}:${PORT}`);
