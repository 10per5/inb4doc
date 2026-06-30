import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, extname, dirname, relative, resolve } from "path";
import { sanitizeImageName } from "../src/utils/sanitize";

export interface ServerContext {
  contentDir: string;
  disableApi: boolean;
  noIgnore: boolean;
  treeDepth: number;
  maxContentSize?: number; // bytes, default 10MB
}

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

function resolveWithin(target: string, base: string): string | null {
  const resolved = resolve(target);
  const rel = relative(base, resolved);
  if (rel.startsWith("..")) return null;
  return resolved;
}

function extractWeight(filePath: string): number | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const weightMatch = match[1].match(/^weight:\s*(\d+)/m);
      if (weightMatch) return parseInt(weightMatch[1], 10);
    }
  } catch {}
  return undefined;
}

interface GitIgnorePattern {
  pattern: string
  negate: boolean
  dirOnly: boolean
  anchored: boolean
}

function loadGitignore(dir: string): GitIgnorePattern[] {
  const giPath = join(dir, ".gitignore");
  if (!existsSync(giPath)) return [];
  const content = readFileSync(giPath, "utf-8");
  const patterns: GitIgnorePattern[] = [];
  for (let line of content.split("\n")) {
    line = line.trimEnd();
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) { negate = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith("/")) { dirOnly = true; line = line.slice(0, -1); }
    if (!line) continue;
    patterns.push({ pattern: line, negate, dirOnly, anchored: line.includes("/") });
  }
  return patterns;
}

function globMatch(pat: string, pi: number, str: string, si: number): boolean {
  for (;;) {
    if (pi === pat.length && si === str.length) return true;
    if (pi + 1 < pat.length && pat[pi] === "*" && pat[pi + 1] === "*") {
      pi += 2;
      if (pi === pat.length) return true;
      for (let i = si; i <= str.length; i++)
        if (globMatch(pat, pi, str, i)) return true;
      return false;
    }
    if (pi < pat.length && pat[pi] === "*") {
      pi++;
      for (let i = si; i <= str.length; i++) {
        if (i > si && str[i - 1] === "/") break;
        if (globMatch(pat, pi, str, i)) return true;
      }
      return false;
    }
    if (pi < pat.length && pat[pi] === "?") {
      if (si >= str.length || str[si] === "/") return false;
      pi++; si++; continue;
    }
    if (pi < pat.length && si < str.length && pat[pi] === str[si]) {
      pi++; si++; continue;
    }
    return false;
  }
}

function isIgnored(
  name: string, isDir: boolean, patterns: GitIgnorePattern[]
): boolean {
  let ignored = false;
  for (const p of patterns) {
    if (p.dirOnly && !isDir) continue;
    let matched = false;
    if (p.anchored) {
      matched = globMatch(p.pattern, 0, name, 0);
    } else {
      const slash = name.lastIndexOf("/");
      const base = slash === -1 ? name : name.slice(slash + 1);
      matched = globMatch(p.pattern, 0, base, 0);
    }
    if (matched) ignored = !p.negate;
  }
  return ignored;
}

function buildTree(
  dir: string,
  giPatterns: GitIgnorePattern[] = [],
  depth: number = 0,
  currentDepth: number = 0,
  noIgnore: boolean = false,
  relPrefix: string = ""
): Record<string, any> {
  const result: Record<string, any> = {};
  if (!existsSync(dir)) return result;
  const recurse = depth === 0 || currentDepth < depth;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const relPath = relPrefix ? `${relPrefix}/${name}` : name;
    const stat = statSync(full);
    const isDir = stat.isDirectory();

    if (!noIgnore && isIgnored(relPath, isDir, giPatterns)) continue;

    if (isDir) {
      if (!recurse) continue;
      const childGi = loadGitignore(full);
      const merged = [...giPatterns, ...childGi];
      const childRel = relPrefix ? `${relPrefix}/${name}` : name;
      const children = buildTree(full, merged, depth, currentDepth + 1, noIgnore, childRel);
      if (Object.keys(children).length > 0) result[name] = children;
    } else if (name.endsWith(".md")) {
      const weight = extractWeight(full);
      result[name] = weight != null ? { weight } : null;
    }
  }
  return result;
}

function removeOrphanedImages(docRelPath: string, ctx: ServerContext): void {
  const imageDir = docRelPath ? join(ctx.contentDir, docRelPath, "image") : join(ctx.contentDir, "image");
  if (!existsSync(imageDir)) return;
  for (const name of readdirSync(imageDir)) {
    if (!IMAGE_EXTS.has(extname(name).toLowerCase())) continue;
    const refs = findImageRefs(ctx.contentDir, imageDir, name);
    if (refs.length === 0) {
      rmSync(join(imageDir, name), { force: true });
    }
  }
  if (readdirSync(imageDir).length === 0) {
    rmSync(imageDir, { force: true });
    // Clean up empty parent directories up to content root
    let dir = dirname(imageDir);
    while (dir.startsWith(ctx.contentDir)) {
      try {
        const entries = readdirSync(dir);
        if (entries.length > 0) break;
        rmdirSync(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
  }
}

// ── Content API ──────────────────────────────────────────────────────────

async function handleContent(req: Request, relPath: string, ctx: ServerContext): Promise<Response | null> {
  const basePath = resolveWithin(join(ctx.contentDir, relPath), ctx.contentDir);
  if (!basePath) return new Response(null, { status: 403 });
  const hasExt = !!extname(basePath);
  const target = hasExt ? basePath : basePath + ".md";

  if (!target.endsWith(".md")) {
    return new Response(null, { status: 404 });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (!existsSync(target)) return new Response(null, { status: 404 });
    if (req.method === "HEAD") return new Response(null, { status: 200 });
    const content = readFileSync(target);
    return new Response(content, {
      headers: { "Content-Type": "text/markdown" },
    });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    const limit = ctx.maxContentSize ?? 10 * 1024 * 1024;
    if (text.length > limit)
      return new Response("Content too large", { status: 413 });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf-8");
    // Remove orphaned images after content update
    try { removeOrphanedImages(dirname(path), ctx); } catch {}
    return new Response("ok");
  }

  if (req.method === "DELETE") {
    if (!existsSync(target)) return new Response(null, { status: 404 });
    rmSync(target, { force: true });
    let dir = dirname(target);
    while (dir.startsWith(ctx.contentDir)) {
      try {
        const entries = readdirSync(dir);
        if (entries.length > 0) break;
        rmdirSync(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
    // Remove orphaned images
    try { removeOrphanedImages(dirname(path), ctx); } catch {}
    return new Response("ok");
  }

  return new Response(null, { status: 405 });
}

function handleTree(ctx: ServerContext): Response | null {
  const giPatterns = ctx.noIgnore ? [] : loadGitignore(ctx.contentDir);
  return new Response(JSON.stringify(buildTree(ctx.contentDir, giPatterns, ctx.treeDepth, 0, ctx.noIgnore)), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleUpload(req: Request, ctx: ServerContext): Promise<Response | null> {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const docDir = form.get("dir") as string | null;

  if (!file) return new Response("No file", { status: 400 });
  const limit = ctx.maxContentSize ?? 10 * 1024 * 1024;
  if (file.size > limit)
    return new Response("File too large", { status: 413 });

  const rawTargetDir = docDir ? join(ctx.contentDir, docDir, "image") : join(ctx.contentDir, "image");
  const targetDir = resolveWithin(rawTargetDir, ctx.contentDir);
  if (!targetDir) return new Response("Forbidden", { status: 403 });

  const name = sanitizeImageName(file.name);
  const targetPath = join(targetDir, name);

  mkdirSync(targetDir, { recursive: true });
  const buf = await file.arrayBuffer();
  writeFileSync(targetPath, new Uint8Array(buf));

  const url = docDir ? `image/${name}` : `/uploads/image/${name}`;
  return new Response(JSON.stringify({ url }), {
    headers: { "Content-Type": "application/json" },
  });
}

function handleUploads(relPath: string, ctx: ServerContext): Response | null {
  const filePath = resolveWithin(join(ctx.contentDir, relPath), ctx.contentDir);
  if (!filePath) return new Response(null, { status: 403 });
  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return new Response(null, { status: 403 });
  if (!filePath.includes("/image/") && !filePath.endsWith("/image"))
    return new Response(null, { status: 403 });
  if (!existsSync(filePath)) return new Response(null, { status: 404 });
  if (statSync(filePath).isDirectory()) return new Response(null, { status: 403 });
  const raw = readFileSync(filePath);
  return new Response(raw, {
    headers: { "Content-Type": contentType(filePath) },
  });
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);

// ── Search API ────────────────────────────────────────────────────────────

function extractTableCells(table: string, query: string): string[] {
  const q = query.toLowerCase();
  const rows = table.split("\n").filter(r => r.trim().startsWith("|") && !r.includes("---"));
  const results: string[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri].split("|").slice(1, -1).map(c => c.trim());
    for (let ci = 0; ci < cells.length; ci++) {
      if (cells[ci].toLowerCase().includes(q)) {
        results.push(cells[ci]);
      }
    }
  }
  return results;
}

function extractSnippets(content: string, query: string, maxSnippets = 3): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const paragraphs = content.split(/\n\s*\n/);
  const snippets: string[] = [];
  for (const para of paragraphs) {
    if (para.toLowerCase().includes(q)) {
      if (para.trim().startsWith("|")) {
        const cells = extractTableCells(para, q);
        snippets.push(...cells);
      } else {
        snippets.push(para.trim());
      }
      if (snippets.length >= maxSnippets) break;
    }
  }
  return snippets;
}

async function handleSearch(req: Request, ctx: ServerContext): Promise<Response | null> {
  const { query } = await req.json();
  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const q = query.toLowerCase().trim();
  if (!q) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: { path: string; snippets: string[] }[] = [];

  function walk(dir: string, prefix: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (name === "image") continue;
        walk(full, prefix ? `${prefix}/${name}` : name);
      } else if (name.endsWith(".md")) {
        const content = readFileSync(full, "utf-8");
        if (content.toLowerCase().includes(q)) {
          const path = prefix ? `${prefix}/${name}` : name;
          results.push({
            path: path.replace(/\.md$/, ""),
            snippets: extractSnippets(content, q),
          });
        }
      }
    }
  }

  walk(ctx.contentDir, "");
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
}

function handleListImages(req: Request, ctx: ServerContext): Response | null {
  const url = new URL(req.url);
  const docDir = url.searchParams.get("dir") || "";
  const refs = url.searchParams.get("refs") === "true";
  const imageDir = resolveWithin(
    docDir ? join(ctx.contentDir, docDir, "image") : join(ctx.contentDir, "image"),
    ctx.contentDir
  );
  if (!imageDir) return new Response("Forbidden", { status: 403 });

  if (!existsSync(imageDir)) {
    return new Response(JSON.stringify({ images: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const names = readdirSync(imageDir)
    .filter((n) => IMAGE_EXTS.has(extname(n).toLowerCase()))
    .sort();

  const images = names.map((name) => {
    const entry: { name: string; url: string; usedIn?: string[] } = {
      name,
      url: `/uploads/${join(docDir, "image", name)}`,
    };
    if (refs) {
      entry.usedIn = findImageRefs(ctx.contentDir, imageDir, name);
    }
    return entry;
  });

  return new Response(JSON.stringify({ images }), {
    headers: { "Content-Type": "application/json" },
  });
}

function findImageRefs(contentDir: string, imageDir: string, imageName: string): string[] {
  const refs: string[] = [];
  const scanDir = dirname(imageDir);
  if (!existsSync(scanDir)) return refs;

  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.startsWith(".")) continue;
      if (statSync(full).isDirectory()) {
        if (entry === "image") continue; // skip image dirs to avoid infinite loops
        scan(full);
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(full, "utf-8");
        if (content.includes(imageName)) {
          const rel = full.replace(contentDir, "").replace(/^\//, "");
          refs.push(rel);
        }
      }
    }
  }
  scan(scanDir);
  return refs;
}

function handleDeleteImage(req: Request, path: string, ctx: ServerContext): Response | null {
  const name = path.slice("/api/images/".length);
  if (!name) return new Response("Missing image name", { status: 400 });

  const url = new URL(req.url);
  const docDir = url.searchParams.get("dir") || "";
  const imageDir = docDir ? join(ctx.contentDir, docDir, "image") : join(ctx.contentDir, "image");
  const imageBase = resolveWithin(imageDir, ctx.contentDir);
  if (!imageBase) return new Response("Forbidden", { status: 403 });
  const target = resolveWithin(join(imageBase, name), ctx.contentDir);
  if (!target) return new Response("Forbidden", { status: 403 });

  if (!existsSync(target)) {
    return new Response("Not found", { status: 404 });
  }

  rmSync(target, { force: true });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMove(req: Request, ctx: ServerContext): Promise<Response | null> {
  const { from, to } = await req.json();
  const src = resolveWithin(join(ctx.contentDir, from.replace(/^\//, "")), ctx.contentDir);
  const dst = resolveWithin(join(ctx.contentDir, to.replace(/^\//, "")), ctx.contentDir);
  if (!src || !dst) return new Response("Forbidden", { status: 403 });
  if (!src.endsWith(".md") || !dst.endsWith(".md"))
    return new Response("Forbidden", { status: 403 });
  if (!existsSync(src)) return new Response("Source not found", { status: 404 });
  if (existsSync(dst)) return new Response("Destination exists", { status: 409 });

  mkdirSync(dirname(dst), { recursive: true });
  const text = readFileSync(src, "utf-8");
  writeFileSync(dst, text, "utf-8");
  rmSync(src, { force: true });

  let dir = dirname(src);
  while (dir.startsWith(ctx.contentDir)) {
    try {
      const entries = readdirSync(dir);
      if (entries.length > 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }

  return new Response("ok");
}

// ── Public API ───────────────────────────────────────────────────────────

export async function handleApiRoutes(
  req: Request,
  path: string,
  ctx: ServerContext
): Promise<Response | null> {
  if (ctx.disableApi) return null;

  if (path === "/content" || path.startsWith("/content/")) {
    const relPath = path.slice("/content/".length);
    return handleContent(req, relPath, ctx);
  }

  if (path === "/api/tree") {
    return handleTree(ctx);
  }

  if (path === "/api/upload" && req.method === "POST") {
    return handleUpload(req, ctx);
  }

  if (path.startsWith("/uploads/") && req.method === "GET") {
    const relPath = path.slice("/uploads/".length);
    return handleUploads(relPath, ctx);
  }

  if (path === "/api/move" && req.method === "POST") {
    return handleMove(req, ctx);
  }

  if (path === "/api/images" && req.method === "GET") {
    return handleListImages(req, ctx);
  }

  if (path.startsWith("/api/images/") && req.method === "DELETE") {
    return handleDeleteImage(req, path, ctx);
  }

  if (path === "/api/search" && req.method === "POST") {
    return handleSearch(req, ctx);
  }

  return null;
}
