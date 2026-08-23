import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_SIGS = [
  "shiki",
  "katex",
  "oniguruma",
  "prosemirror",
  "prosekit",
  "codemirror",
  "lezer",
  "aria-ui",
  "floating-ui",
  "unified",
  "micromark",
  "mdast",
  "remark",
  "turndown",
  "stimulus",
  "eta",
  "fflate",
];

const BLOB_MIN_RUN = 5000;
const TOP_STR_MIN = 15000;

interface Asset {
  path: string;
  name: string;
  size: number;
}

interface BlobHit {
  kb: number;
  offsetMb: number;
  context: string;
}

interface StrHit {
  kb: number;
  offsetMb: number;
  context: string;
  head: string;
}

interface ChunkReport {
  file: string;
  bytes: number;
  signatures: Record<string, number>;
  blobs: BlobHit[];
  blobTotalKb: number;
  topStrings: StrHit[];
}

interface MetaReport {
  path: string;
  stale: boolean;
  mtime: string;
  newestAssetMtime: string | null;
  totalMb: number;
  packages: Array<{ pkg: string; mb: number }>;
}

interface MetaDiffRow {
  pkg: string;
  oldMb: number;
  newMb: number;
  deltaMb: number;
}

interface MetaDiff {
  oldMtime: string;
  newMtime: string;
  oldTotalMb: number;
  newTotalMb: number;
  rows: MetaDiffRow[];
}

interface Report {
  distDir: string;
  assets: Asset[];
  chunks: ChunkReport[];
  meta: MetaReport | null;
  compare: MetaDiff | null;
}

function usage(): string {
  return [
    "chunk-analytics — inspect built JS/CSS assets for bloat",
    "",
    "Usage: bun lib/chunk-analytics.ts [patterns...] [options]",
    "",
    "  patterns        substrings matched against asset names for deep-dive",
    "                  (no patterns = overview listing only)",
    "  --dist <dir>    assets directory (default: dist/assets or public/assets)",
    "  --meta <path>   metafile to aggregate (default: ./meta.json)",
    "  --compare <p>   second metafile; prints per-package old-vs-new diff",
    "  --sig a,b,c     add signatures to the scan list",
    "  --top N         show N largest embedded string literals (default 8)",
    "  --json          machine-readable output",
    "  --help          this text",
  ].join("\n");
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    patterns: [],
    sigs: [...DEFAULT_SIGS],
    top: 8,
    json: false,
    dist: "",
    meta: "",
    compare: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") o.dist = argv[++i] ?? "";
    else if (a === "--meta") o.meta = argv[++i] ?? "";
    else if (a === "--compare") o.compare = argv[++i] ?? "";
    else if (a === "--sig") o.sigs.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--top") o.top = Number(argv[++i] ?? 8);
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") {
      o.help = true;
      break;
    } else if (!a.startsWith("-")) o.patterns.push(a);
  }
  return o;
}

interface Opts {
  patterns: string[];
  sigs: string[];
  top: number;
  json: boolean;
  dist: string;
  meta: string;
  compare: string;
  help: boolean;
}

async function resolveDist(explicit: string): Promise<string> {
  const candidates = explicit ? [explicit] : ["dist/assets", "public/assets"];
  for (const dir of candidates) {
    try {
      await stat(dir);
      return dir;
    } catch {}
  }
  throw new Error(`assets directory not found (tried: ${candidates.join(", ")})`);
}

async function listAssets(dir: string): Promise<Asset[]> {
  const names = await readdir(dir);
  const out: Asset[] = [];
  for (const name of names) {
    const s = await stat(join(dir, name));
    if (s.isFile()) out.push({ path: join(dir, name), name, size: s.size });
  }
  return out.sort((a, b) => b.size - a.size);
}

function countOccurrences(text: string, needle: string): number {
  let n = 0;
  let i = -1;
  while ((i = text.indexOf(needle, i + 1)) >= 0) n++;
  return n;
}

function contextBefore(text: string, index: number, len = 70): string {
  return text.slice(Math.max(0, index - len), index).slice(-len);
}

function findBlobs(text: string): { hits: BlobHit[]; totalKb: number } {
  const re = /[A-Za-z0-9+/]{5000,}={0,2}/g;
  const hits: BlobHit[] = [];
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    total += m[0].length;
    hits.push({
      kb: Math.round(m[0].length / 1024),
      offsetMb: +(m.index / 1048576).toFixed(2),
      context: contextBefore(text, m.index),
    });
  }
  hits.sort((a, b) => b.kb - a.kb);
  return { hits: hits.slice(0, 10), totalKb: Math.round(total / 1024) };
}

function findTopStrings(text: string, limit: number): StrHit[] {
  const re = new RegExp(`"((?:[^"\\\\]|\\\\.){${TOP_STR_MIN},})"`, "g");
  const hits: StrHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && hits.length < limit * 3) {
    hits.push({
      kb: Math.round(m[1].length / 1024),
      offsetMb: +(m.index / 1048576).toFixed(2),
      context: contextBefore(text, m.index),
      head: m[1].slice(0, 80),
    });
  }
  hits.sort((a, b) => b.kb - a.kb);
  return hits.slice(0, limit);
}

async function analyzeChunk(asset: Asset, sigs: string[], top: number): Promise<ChunkReport> {
  const text = await Bun.file(asset.path).text();
  const signatures: Record<string, number> = {};
  for (const sig of sigs) {
    const n = countOccurrences(text, sig);
    if (n > 0) signatures[sig] = n;
  }
  const { hits, totalKb } = findBlobs(text);
  return {
    file: asset.name,
    bytes: asset.size,
    signatures,
    blobs: hits,
    blobTotalKb: totalKb,
    topStrings: top > 0 ? findTopStrings(text, top) : [],
  };
}

function pkgOf(path: string): string {
  const nm = path.indexOf("node_modules/");
  if (nm < 0) return "(src)";
  const rest = path.slice(nm + "node_modules/".length);
  const parts = rest.split("/");
  return rest.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

interface MetaAgg {
  totalBytes: number;
  packages: Map<string, number>;
}

async function aggregateMeta(path: string): Promise<MetaAgg> {
  const parsed = JSON.parse(await Bun.file(path).text()) as {
    inputs?: Record<string, { bytes?: number }>;
  };
  const packages = new Map<string, number>();
  let total = 0;
  for (const [p, info] of Object.entries(parsed.inputs ?? {})) {
    const bytes = info.bytes ?? 0;
    const pkg = pkgOf(p);
    packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
    total += bytes;
  }
  return { totalBytes: total, packages };
}

async function analyzeMeta(metaPath: string, assets: Asset[]): Promise<MetaReport | null> {
  let metaStat;
  try {
    metaStat = await stat(metaPath);
  } catch {
    return null;
  }
  let newestAssetMtime: string | null = null;
  for (const a of assets.slice(0, 5)) {
    const s = await stat(a.path);
    if (!newestAssetMtime || s.mtime > new Date(newestAssetMtime)) newestAssetMtime = s.mtime.toISOString();
  }
  const { totalBytes, packages } = await aggregateMeta(metaPath);
  return {
    path: metaPath,
    stale: newestAssetMtime !== null && metaStat.mtime < new Date(newestAssetMtime),
    mtime: metaStat.mtime.toISOString(),
    newestAssetMtime,
    totalMb: +(totalBytes / 1048576).toFixed(2),
    packages: [...packages]
      .map(([pkg, bytes]) => ({ pkg, mb: +(bytes / 1048576).toFixed(2) }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 20),
  };
}

async function diffMetas(oldPath: string, newPath: string): Promise<MetaDiff> {
  const [oldAgg, newAgg] = await Promise.all([aggregateMeta(oldPath), aggregateMeta(newPath)]);
  const keys = new Set([...oldAgg.packages.keys(), ...newAgg.packages.keys()]);
  const rows: MetaDiffRow[] = [...keys]
    .map((pkg) => {
      const oldMb = (oldAgg.packages.get(pkg) ?? 0) / 1048576;
      const newMb = (newAgg.packages.get(pkg) ?? 0) / 1048576;
      return { pkg, oldMb: +oldMb.toFixed(2), newMb: +newMb.toFixed(2), deltaMb: +(newMb - oldMb).toFixed(2) };
    })
    .sort((a, b) => Math.abs(b.deltaMb) - Math.abs(a.deltaMb));
  const [o, n] = await Promise.all([stat(oldPath), stat(newPath)]);
  return {
    oldMtime: o.mtime.toISOString(),
    newMtime: n.mtime.toISOString(),
    oldTotalMb: +(oldAgg.totalBytes / 1048576).toFixed(2),
    newTotalMb: +(newAgg.totalBytes / 1048576).toFixed(2),
    rows,
  };
}

function fmtSize(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function printHuman(report: Report): void {
  console.log(`# ${report.distDir} (${report.assets.length} files)`);
  for (const a of report.assets) console.log(fmtSize(a.size).padStart(10), a.name);

  if (report.meta) {
    const m = report.meta;
    console.log(`\n# meta.json ${m.stale ? "STALE (older than newest asset)" : "fresh"}`);
    console.log(`  written ${m.mtime}, covers ${m.totalMb} MB of inputs`);
    if (m.newestAssetMtime) console.log(`  newest asset: ${m.newestAssetMtime}`);
    for (const p of m.packages.slice(0, 12)) console.log((p.mb.toFixed(2) + " MB").padStart(10), p.pkg);
    if (m.stale) console.log("  ^ numbers above do NOT reflect the current build");
  }

  if (report.compare) {
    const d = report.compare;
    const delta = d.newTotalMb - d.oldTotalMb;
    console.log(`\n# meta diff ${d.oldMtime} -> ${d.newMtime}`);
    console.log(`  inputs total: ${d.oldTotalMb.toFixed(2)} MB -> ${d.newTotalMb.toFixed(2)} MB (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`);
    console.log("         delta      old      new  package");
    for (const r of d.rows.slice(0, 30)) {
      const sign = r.deltaMb >= 0 ? "+" : "";
      console.log(`  ${sign}${r.deltaMb.toFixed(2).padStart(8)}  ${r.oldMb.toFixed(2).padStart(8)}  ${r.newMb.toFixed(2).padStart(8)}  ${r.pkg}`);
    }
  }

  for (const c of report.chunks) {
    console.log(`\n## ${c.file} (${fmtSize(c.bytes)})`);
    console.log("  signatures:");
    for (const [sig, n] of Object.entries(c.signatures)) console.log(`    ${sig.padEnd(14)} ${n}`);
    console.log(`  embedded blobs: ${c.blobTotalKb} KB total`);
    for (const b of c.blobs) console.log(`    ${String(b.kb).padStart(6)} KB @ ${b.offsetMb} MB  ctx: ${JSON.stringify(b.context)}`);
    if (c.topStrings.length) {
      console.log("  largest string literals:");
      for (const s of c.topStrings) console.log(`    ${String(s.kb).padStart(6)} KB @ ${s.offsetMb} MB  ctx: ${JSON.stringify(s.context)}\n      head: ${JSON.stringify(s.head)}`);
    }
  }

  if (!report.chunks.length) console.log("\n(deep-dive needs name patterns, e.g.: bun lib/chunk-analytics.ts node_imports)");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  const distDir = await resolveDist(opts.dist);
  const assets = await listAssets(distDir);
  const matched = opts.patterns.length ? assets.filter((a) => opts.patterns.some((p) => a.name.includes(p))) : [];
  const missing = opts.patterns.filter((p) => !matched.some((a) => a.name.includes(p)));
  for (const p of missing) console.error(`warning: no asset matches "${p}"`);

  const chunks: ChunkReport[] = [];
  for (const asset of matched) chunks.push(await analyzeChunk(asset, opts.sigs, opts.top));

  const metaPath = opts.meta || join(process.cwd(), "meta.json");
  const report: Report = {
    distDir,
    assets: opts.json ? assets : assets.slice(0, 25),
    chunks,
    meta: await analyzeMeta(metaPath, assets),
    compare: opts.compare ? await diffMetas(opts.compare, metaPath) : null,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

await main();
