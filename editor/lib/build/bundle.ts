import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import {
  resolveConfig,
  createCompiler,
  createBundleHandler,
  NoopLogger,
} from "@farmfe/core";

export interface BundleOptions {
  cwd: string;
  dev: boolean;
  withMeta: boolean;
  onUpdate?: () => void;
}

export interface BundleResult {
  exitCode: number;
}

// Farm's writeResourcesToDisk() writes every chunk on every watch rebuild even
// when nothing changed (content-hash names stay stable), which strips the
// self-evict prelude and forces a full disk rewrite + re-injection per edit.
// patchIncrementalWrite() swaps in a writer that skips resources byte-identical
// to the previous compilation — the file on disk is already the injected
// version of those exact bytes, so the prelude survives and injectSelfEvicting
// no-ops. Only genuinely changed chunks (new content-hash names) get written.
// The `prev !== resource` guard keeps it safe even if Farm ever reuses the same
// Buffer object across compilations (we then fall back to writing it).
let lastFarmResources: Record<string, Buffer> | null = null;

function patchIncrementalWrite(compiler: any): void {
  if (compiler.__farmIncrementalWrite) return;
  compiler.__farmIncrementalWrite = true;
  const outputPath = isAbsolute(compiler.config.config.output.path)
    ? compiler.config.config.output.path
    : join(compiler.config.config.root, compiler.config.config.output.path);
  compiler.writeResourcesToDisk = function (this: any) {
    const resources = this.resources() as Record<string, Buffer>;
    for (const [name, resource] of Object.entries(resources)) {
      const nameWithoutQuery = name.split("?")[0];
      const nameWithoutHash = nameWithoutQuery.split("#")[0];
      const filePath = join(outputPath, nameWithoutHash);
      const prev = lastFarmResources?.[name];
      if (prev && prev !== resource && prev.equals(resource)) continue;
      if (!existsSync(dirname(filePath))) {
        mkdirSync(dirname(filePath), { recursive: true });
      }
      writeFileSync(filePath, resource);
    }
    lastFarmResources = resources;
    this.callWriteResourcesHook();
  };
}

const CTRL_SUFFIX_RE = /[-_]controller$/;
const EXT_TS = ".ts";
const DIALOG_SUBDIR = "dialog";
// Controllers never registered in app.ts (e.g. the abstract base class) get no
// chunk-map entry, no prune target, and no swap rule.
const EXCLUDED_CONTROLLER_IDS = new Set(["base-dialog"]);

// Import-scan pairing: a controller pairs with the compiled template(s) it
// actually imports at runtime (`import renderTopbar from
// "@/eta/views/controller/topbar"`). The import IS the pairing — no filename
// convention. Multiple templates per controller are supported. Variant
// templates composed via Eta include() (e.g. navigation-sidebar included by
// navigation.eta) are inlined at eta-compile time, so they never need pairing.
const TEMPLATE_IMPORT_RE = /from\s+["']@\/eta\/views\/(controller|dialog)\/([\w-]+)["']/g;

interface ControllerReg {
  id: string;
  rel: string;
  isDialog: boolean;
  // Compiled template rels (relative to src/, e.g. `eta/views/controller/topbar`)
  // this controller imports at runtime — the explicit pairing.
  templates: string[];
}

// ── Chunk-graph manifest (hot vs cold reload decision) ──

// Chunks that can never be hot-swapped: the entry pot's import glue and the
// Farm runtime. Their content is covered by appHash instead.
const ENTRY_CHUNK_NAMES = new Set(["app.js", "__farm_runtime.js"]);

// Stateful singleton pots. Re-running one of these re-initializes live state
// (provider instances, stores, the desktop bridge, the Milkdown editor), so any
// change that reaches them forces a full reload instead of a hot swap.
const COLD_PREFIXES = [
  "stores-",
  "providers-",
  "bridge-",
  "node_imports-",
  "editor-",
  "migrations-",
  "app_",
];

export interface ChunkGraphManifest {
  // chunk filename -> chunk filenames that must re-execute when it changes
  // (the reverse-dependency import closure mapped to chunks, itself included).
  affectedBy: Record<string, string[]>;
  // chunk filename -> true forces a full reload when that chunk changes.
  coldOnChange: Record<string, boolean>;
}

let latestChunkGraphManifest: ChunkGraphManifest | null = null;

export function getLatestChunkGraphManifest(): ChunkGraphManifest | null {
  return latestChunkGraphManifest;
}

// app.js (and the runtime) embed the entry module map, but their text also
// carries build noise: the static chunk import list, the runtime's array of
// every chunk filename, and opaque module ids. Normalizing those away makes the
// hash stable across unrelated rebuilds — it changes only when the entry pot's
// own code changes (app.ts, controllers/index, boot glue), which is exactly
// what must force a cold reload.
export function normalizeEntrySource(text: string): string {
  let s = text;
  s = s.replace(/^(?:import "\.\/[^"]*\.js";)+/, "");
  s = s.replace(/(["'])[^"']*\.js\1/g, '""');
  s = s.replace(/([\(\[,])(["'])[0-9a-f]{8}\2/g, '$1""');
  return s;
}

export function computeAppHash(assetsDir: string): string {
  const parts: string[] = [];
  for (const file of ["app.js", "__farm_runtime.js"]) {
    const p = resolve(assetsDir, file);
    parts.push(existsSync(p) ? normalizeEntrySource(readFileSync(p, "utf8")) : "");
  }
  return createHash("sha1").update(parts.join("\n")).digest("hex");
}

// build-version is stripped too: it increments on every generateSWFiles, so
// including it in the index hash would rotate index-hash (and force a reload)
// on every unrelated rebuild.
const HASH_META_RE = /^\s*<meta name="(?:app-hash|index-hash|build-version)"[^>]*>\s*$/gm;
// linkEmittedCss writes these lines into <head>; css edits rotate the filename,
// and the runtime swaps the <link> href instead of reloading.
const CSS_LINK_RE = /^\s*<link rel="stylesheet" href="assets\/[^"]+\.css" \/>\s*$/gm;

// index.html's volatile bits (the injected hash metas and the emitted-css link
// list) are stripped before hashing so unrelated rebuilds keep a stable hash;
// structural changes (skeleton, baked enum ints, build mode) still move it.
export function computeIndexHash(html: string): string {
  const stripped = html
    .replace(HASH_META_RE, "")
    .replace(CSS_LINK_RE, "");
  return createHash("sha1").update(stripped).digest("hex");
}

export function injectHashMeta(html: string, name: string, value: string): string {
  const tag = `<meta name="${name}" content="${value}" />`;
  const re = new RegExp(`<meta name="${name}"[^>]*>`, "g");
  if (re.test(html)) return html.replace(re, tag);
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

function computeChunkManifest(
  compiler: any,
  cwd: string,
  assetsDir: string
): Promise<ChunkGraphManifest> {
  return (async () => {
    const resources = compiler.resourcesMap() as Record<
      string,
      { info?: { moduleIds?: string[] } }
    >;
    const graph = await compiler.traceModuleGraph();
    const reverseEdges = (graph.reverseEdges ?? {}) as Record<string, string[]>;

    // module id (source path) -> chunk filename. Entry chunks are excluded so
    // the closure never tries to hot-swap the entry pot.
    const moduleToChunk: Record<string, string> = {};
    for (const name of Object.keys(resources)) {
      if (!name.endsWith(".js") || ENTRY_CHUNK_NAMES.has(name)) continue;
      for (const id of resources[name].info?.moduleIds ?? []) {
        moduleToChunk[id] = name;
      }
    }

    // Chunks that may be hot-swapped: controller chunks in the swap map (editor
    // and the abstract base-dialog are deliberately excluded, matching
    // getChunkMap).
    const controllers = discoverControllers(
      resolve(cwd, "src/controllers"),
      resolve(cwd, "src")
    );
    const swappable = new Set<string>();
    for (const { id } of controllers) {
      if (EXCLUDED_CONTROLLER_IDS.has(id) || id === "editor") continue;
      const file = findChunkFile(assetsDir, id);
      if (file) swappable.add(file);
    }

    const affectedBy: Record<string, string[]> = {};
    const coldOnChange: Record<string, boolean> = {};

    // Sort for a deterministic manifest — resourcesMap key order varies between
    // compiles, and an unordered object would rotate sw-assets.js on every
    // identical rebuild (and re-transfer it through the cache-skip).
    for (const name of Object.keys(resources).sort()) {
      if (!name.endsWith(".js") || ENTRY_CHUNK_NAMES.has(name)) continue;
      const moduleIds = resources[name].info?.moduleIds ?? [];
      const seen = new Set<string>();
      const affected = new Set<string>([name]);
      const queue = [...moduleIds];
      while (queue.length) {
        const m = queue.pop()!;
        if (seen.has(m)) continue;
        seen.add(m);
        for (const imp of reverseEdges[m] ?? []) {
          if (seen.has(imp)) continue;
          const chunk = moduleToChunk[imp];
          if (chunk) affected.add(chunk);
          queue.push(imp);
        }
      }
      const closure = [...affected].sort();
      affectedBy[name] = closure;
      const selfCold = COLD_PREFIXES.some((p) => name.startsWith(p));
      const reachesCold = closure.some((c) =>
        COLD_PREFIXES.some((p) => c.startsWith(p))
      );
      // A chunk whose moduleIds are all .css (the styles-*.js pots) is a set of
      // idempotent style injectors: re-importing it re-registers the css
      // factories and the swap re-executes them, which replaces the matching
      // <style> in place. It applies itself, so the !reachesController penalty
      // below — meant for leaf modules whose only importers are entry modules —
      // doesn't apply: a css-only chunk is hot even though nothing in its
      // closure is a swappable controller.
      const selfApplying =
        moduleIds.length > 0 && moduleIds.every((id) => id.endsWith(".css"));
      // A change is only hot if some chunk in the closure is a swappable
      // controller that will re-execute it; a leaf module whose only importers
      // are entry modules can't be applied without a reload.
      const reachesController = closure.some((c) => swappable.has(c));
      coldOnChange[name] =
        selfCold || reachesCold || (!selfApplying && !reachesController);
    }

    return { affectedBy, coldOnChange };
  })();
}

// Each Stimulus controller becomes its own chunk. A controller paired with a
// compiled template (src/eta/views/controller/<id>.ts for non-dialogs,
// src/eta/views/dialog/<id>.ts for dialogs) is bundled together with that
// template — the pairing is the controller's own template import, scanned from
// source (see TEMPLATE_IMPORT_RE). Dialog controllers additionally pull their
// facade helper (src/controllers/dialog/<id>.type.ts, holding the dialog types
// and open*Dialog() opener) into the same chunk so controller + helper +
// template reload as one unit.
function discoverControllers(
  controllersDir: string,
  srcDir: string
): ControllerReg[] {
  const result: ControllerReg[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(EXT_TS)) continue;
      const name = entry.name.slice(0, -EXT_TS.length);
      const id = name.replace(CTRL_SUFFIX_RE, "");
      if (id === name) continue;
      const rel = relative(srcDir, full)
        .split(sep)
        .join("/")
        .replace(EXT_TS, "");
      const isDialog = rel.startsWith(`controllers/${DIALOG_SUBDIR}/`);
      const templates = scanTemplateImports(full, srcDir);
      result.push({ id, rel, isDialog, templates });
    }
  }

  walk(controllersDir);
  return result;
}

function scanTemplateImports(controllerFile: string, srcDir: string): string[] {
  const source = readFileSync(controllerFile, "utf-8");
  const templates: string[] = [];
  for (const match of source.matchAll(TEMPLATE_IMPORT_RE)) {
    const rel = `eta/views/${match[1]}/${match[2]}`;
    if (!existsSync(resolve(srcDir, `${rel}.ts`))) continue;
    if (!templates.includes(rel)) templates.push(rel);
  }
  return templates;
}

function controllerRules(
  controllers: ControllerReg[]
): Array<{ name: string; test: string[] }> {
  return controllers
    .filter((c) => !EXCLUDED_CONTROLLER_IDS.has(c.id))
    .map((c) => {
      // A controller in its own subfolder (e.g. src/controllers/meta-panel/)
      // claims the whole folder so helper modules reload with it. Only treat
      // controllers with a real subfolder this way — a flat controller's rel
      // still starts with "controllers/", which must not become a folder rule.
      const folder = !c.isDialog && c.rel.split("/").length > 2
        ? c.rel.slice(0, c.rel.lastIndexOf("/"))
        : null;
      const test = c.isDialog
        ? [
            `.*src/controllers/dialog/${c.id}(?:-controller|\\.type)?\\.ts`,
            ...c.templates.map((t) => `.*${t}\\.ts`),
          ]
        : folder
          ? [
              `.*src/${folder}/.*`,
              ...c.templates.map((t) => `.*${t}\\.ts`),
            ]
          : c.templates.length
            ? [`.*${c.rel}\\.ts`, ...c.templates.map((t) => `.*${t}\\.ts`)]
            : [`.*${c.rel}\\.ts`];
      return { name: c.id, test };
    });
}

const SRC_DOMAIN_RULES: Array<{ name: string; test: string[] }> = [
  // NOTE: listed after the per-controller rules so a controller's paired
  // template (src/eta/views/controller/<id>.ts) is claimed by its controller.
  // conditions.css (generated into src/eta/styles/) is app stylesheet CSS, not
  // a template module: claiming it into the styles chunk keeps base rules and
  // their build-conditional overrides in one emitted css in import order, so
  // same-specificity overrides (e.g. .dock-fab-menu over .toolbar-menu) resolve
  // correctly instead of fighting across eta-*.css and styles-*.css links.
  { name: "styles", test: [".*src/eta/styles/.*"] },
  { name: "eta", test: [".*src/eta/.*"] },
  { name: "components", test: [".*src/components/.*"] },
  { name: "config", test: [".*src/config/.*"] },
  { name: "stores", test: [".*src/stores/.*"] },
  { name: "services", test: [".*src/services/.*"] },
  { name: "features", test: [".*src/features/.*"] },
  { name: "plugins", test: [".*src/plugins/.*"] },
  { name: "providers", test: [".*src/providers/.*"] },
  { name: "entities", test: [".*src/entities/.*"] },
  { name: "utils", test: [".*src/utils/.*"] },
  { name: "bridge", test: [".*src/bridge/.*"] },
  { name: "migrations", test: [".*src/migrations/.*"] },
  { name: "styles", test: [".*src/styles/.*"] },
];

// Chunk filenames that app.js references. Farm can emit an orphan duplicate
// controller pot in a single compile (a partialBundling quirk) — the entry
// imports one copy while an identical-named, newer pot nobody imports lands on
// disk too. app.js is ground truth for what the page needs, so pruning and the
// chunk map must prefer the referenced copy and drop the orphan, otherwise the
// page 404s on the chunk it actually imports.
function referencedChunkSet(assetsDir: string): Set<string> {
  const appPath = resolve(assetsDir, "app.js");
  if (!existsSync(appPath)) return new Set();
  const text = readFileSync(appPath, "utf8");
  return new Set(
    readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js") && text.includes(f))
  );
}

function findChunkFile(assetsDir: string, id: string): string | null {
  const candidates = readdirSync(assetsDir).filter(
    (f) => f.endsWith(".js") && (f === `${id}.js` || f.startsWith(`${id}-`))
  );
  if (candidates.length === 0) return null;
  const referenced = referencedChunkSet(assetsDir);
  candidates.sort((a, b) => {
    const ra = referenced.has(a) ? 1 : 0;
    const rb = referenced.has(b) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return (
      statSync(resolve(assetsDir, b)).mtimeMs -
      statSync(resolve(assetsDir, a)).mtimeMs
    );
  });
  return candidates[0];
}

// Farm dev keeps `clean: false`, so every rebuild leaves the previous chunk
// versions on disk. That accumulation lets findChunkFile mis-pick a stale
// controller chunk (and a stale sw.js activation would then swap it back in,
// regressing a freshly-loaded page). Keep only the newest chunk per controller
// id so the chunkMap is unambiguous and a stale sw.js chunk request 404s safely.
function pruneStaleControllerChunks(
  assetsDir: string,
  controllers: ControllerReg[]
): void {
  const keep = new Set<string>();
  for (const { id } of controllers) {
    const current = findChunkFile(assetsDir, id);
    if (current) keep.add(current);
  }
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    const base = file.replace(/\.js$/, "");
    const id = base.replace(/-[a-f0-9]+$/, "");
    if (!controllers.some((c) => c.id === id)) continue;
    if (keep.has(file)) continue;
    rmSync(resolve(assetsDir, file), { force: true });
    rmSync(resolve(assetsDir, `${file}.map`), { force: true });
  }
}

// Farm's runtime register() refuses to re-register an already-known module id
// (it warns and keeps the OLD factory), and require() then serves the cached
// stale exports — so a swapped-in controller chunk silently keeps the old code.
// Each emitted chunk is patched to evict its own module ids (ms.delete clears
// the cache and unregisters) right before registering them. Because every chunk
// knows its own module map, this stays correct regardless of how the chunk was
// loaded (native import, script tag) or which chunk hash came before it.
function injectSelfEvicting(assetsDir: string): void {
  if (!existsSync(assetsDir)) return;
  const loop =
    /for\(var r in _\)\{_\[r\]\.__farm_resource_pot__=filename;window\[([^\]]+)\]\.__farm_module_system__\.register\(r,_\[r\]\)\}/;
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    const full = resolve(assetsDir, file);
    const text = readFileSync(full, "utf8");
    if (!loop.test(text) || text.includes("__farm_self_evict")) continue;
    const m = text.match(loop)!;
    const evict = `for(var __farm_self_evict in _){var __farm_ms=window[${m[1]}].__farm_module_system__;if(__farm_ms&&__farm_ms.delete){__farm_ms.delete(__farm_self_evict)}}`;
    writeFileSync(full, text.replace(loop, `${evict}${m[0]}`));
    // patchIncrementalWrite() skips rewriting byte-identical chunks on dev
    // rebuilds, so unchanged files keep their prelude and only genuinely
    // changed chunks land here.
    console.log(`[bundle] injected self-evict into ${file}`);
  }
}

export function getControllerRegs(
  projectRoot: string
): ControllerReg[] {
  const srcDir = resolve(projectRoot, "src");
  return discoverControllers(resolve(srcDir, "controllers"), srcDir);
}

// app.js lists every emitted chunk (verified: in a healthy build every .js file
// except sw-assets.js appears in it), so any .js file outside that referenced
// set is stale: a chunk that was renamed (content hash changed), an old
// node_imports pot, or a leftover from a previous dev session. Dev runs with
// clean:false so these accumulate per session; prune them so findChunkFile and
// the SW never see ambiguous copies. Protected names: the entry (app.js), the
// Farm runtime, and our generated SW manifest (not part of the bundle).
function pruneStaleNonControllerChunks(assetsDir: string): void {
  if (!existsSync(assetsDir)) return;
  const keep = referencedChunkSet(assetsDir);
  keep.add("app.js");
  keep.add("__farm_runtime.js");
  keep.add("sw-assets.js");
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    if (keep.has(file)) continue;
    rmSync(resolve(assetsDir, file), { force: true });
    rmSync(resolve(assetsDir, `${file}.map`), { force: true });
  }
}

export function pruneStaleChunks(
  projectRoot: string,
  assetsDir: string
): void {
  pruneStaleControllerChunks(assetsDir, getControllerRegs(projectRoot));
  pruneStaleNonControllerChunks(assetsDir);
}

export function getChunkMap(
  projectRoot: string,
  assetsPrefix: string
): Record<string, string> {
  const controllers = getControllerRegs(projectRoot);
  const assetsDir = resolve(projectRoot, "public/assets");
  const map: Record<string, string> = {};

  // Non-editor controllers hot-swap individually, dialogs included. The editor
  // controller is excluded: swapping it re-runs its lifecycle (disconnect →
  // new instance → ensureEditor → createEditor) on a container whose Milkdown
  // DOM is still mounted, mounting a second .milkdown div. Keeping it out of
  // the swap map preserves the live editor across SW activations. Re-enable
  // once EditorController.destroy() is safe to re-create.
  for (const { id } of controllers) {
    if (EXCLUDED_CONTROLLER_IDS.has(id) || id === "editor") continue;
    const file = findChunkFile(assetsDir, id);
    if (file) map[id] = `${assetsPrefix}/${file}`;
  }
  return map;
}

function makeEnforceResources(
  cwd: string
): Array<{ name: string; test: string[] }> {
  const srcDir = resolve(cwd, "src");
  const controllers = discoverControllers(
    resolve(srcDir, "controllers"),
    srcDir
  );
  return [
    { name: "app", test: [".*src/app\\.ts"] },
    // Stimulus + Eta + fflate are the only node_modules the eager shell needs
    // (fflate via utils/zip, used by shell_controller's export/load-as-zip).
    // Give them their own pot (all dependency-free leaves) so the node_imports
    // pot — Milkdown / ProseKit / katex & friends — stays reachable ONLY via
    // the lazy editor import and leaves the eager boot set (Part D thin shell).
    {
      name: "vendor",
      test: [
        ".*node_modules/@hotwired/stimulus/.*",
        ".*node_modules/eta/.*",
        ".*node_modules/fflate/.*",
      ],
    },
    { name: "node_imports", test: [".*node_modules.*"] },
    // Per-controller rules first so each controller claims its own chunk (and a
    // dialog controller claims its facade + compiled template). The trailing
    // dialog-common catch-all absorbs base-dialog-controller and stragglers.
    ...controllerRules(controllers),
    { name: "dialog-common", test: [".*src/controllers/dialog/.*"] },
    ...SRC_DOMAIN_RULES,
  ];
}

async function makeConfig(cwd: string, dev: boolean): Promise<any> {
  // The live site is deployed under a subpath (e.g. /inb4doc/editor-live/),
  // so chunk URLs must be prefixed with the editor base rather than root-
  // absolute. Locally EDITOR_SELF_BASE is unset and this stays relative
  // ("assets/") — correct for the desktop app:// and Android
  // file:///android_asset/editor/ hosts, where "/assets/" would miss.
  const selfBase = (process.env.EDITOR_SELF_BASE || "").replace(/\/+$/, "");
  return {
    root: cwd,
    configPath: undefined as string | undefined,
    publicDir: "/tmp/farm-public-empty",
    // HMR is Farm's own full-page reload mechanism (its runtime hmr client
    // opens a WebSocket and calls location.reload() on close). We ship our own
    // service-worker-based swap instead, so disable Farm's HMR to avoid two
    // competing reload paths. Note: compilation.hmr is not a real switch;
    // Farm gates its runtime hmr plugin on server.hmr, which defaults to on.
    server: { hmr: false },
    compilation: {
      input: {
        app: resolve(cwd, "src/app.ts"),
      },
      output: {
        path: resolve(cwd, "public/assets"),
        publicPath: `${selfBase ? `${selfBase}/` : ""}assets/`,
        entryFilename: "[entryName].[ext]",
        filename: "[name]-[hash].[ext]",
        assetsFilename: "[name]-[hash].[ext]",
        clean: !dev,
        targetEnv: "browser-esnext",
        format: "esm",
      },
      resolve: {
        alias: {
          "@": resolve(cwd, "src"),
          "$/": resolve(cwd, "lib") + "/",
        },
      },
      define: {
        "process.env.NODE_ENV": dev ? "'development'" : "'production'",
        __VUE_OPTIONS_API__: "true",
        __VUE_PROD_DEVTOOLS__: "false",
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
      },
      mode: dev ? "development" : "production",
      lazyCompilation: false,
      minify: !dev,
      sourcemap: dev ? true : false,
      treeShaking: true,
      progress: false,
      // Dev persistent cache hits a Farm bug (`resource_cache.rs` unwrap panic)
      // once the cache dir grows stale, aborting the whole watch build. Dev
      // rebuilds are fast enough without it.
      persistentCache: false,
      script: { target: "esnext" },
      partialBundling: {
        targetConcurrentRequests: 1,
        targetMinSize: 100000000,
        enforceResources: makeEnforceResources(cwd),
      },
    },
  };
}

export async function runBundle(options: BundleOptions): Promise<BundleResult> {
  const { cwd, dev } = options;
  const mode = dev ? "development" : "production";
  const logger = new NoopLogger();

  try {
    const inlineConfig = await makeConfig(cwd, dev);
    const resolvedConfig = await resolveConfig(inlineConfig, mode);
    const compiler = await createCompiler(resolvedConfig, logger);
    if (!dev) compiler.removeOutputPathDir();
    await compiler.compile();
    compiler.writeResourcesToDisk();
    injectSelfEvicting(resolve(cwd, "public/assets"));
    try {
      latestChunkGraphManifest = await computeChunkManifest(
        compiler,
        cwd,
        resolve(cwd, "public/assets")
      );
    } catch (err) {
      console.error("[bundle] chunk-graph manifest failed:", err);
    }
    options.onUpdate?.();
    return { exitCode: 0 };
  } catch (err) {
    console.error("[bundle] Farm compile failed:", err);
    return { exitCode: 1 };
  }
}

export async function runBundleWatch(
  cwd: string,
  onUpdate: () => void
): Promise<void> {
  const mode = "development";
  const logger = new NoopLogger();

  try {
    const inlineConfig = await makeConfig(cwd, true);
    const resolvedConfig = await resolveConfig(inlineConfig, mode);
    const assetsDir = resolve(cwd, "public/assets");
    // Farm's compiler.onUpdateFinish() only drains a one-shot queue, so sw.js
    // would refresh at most once after startup and then go stale. Instead hook
    // the writeResources JS plugin hook: writeResourcesToDisk() invokes it on
    // the initial compile AND after every watch rebuild, after the new chunk
    // files are already on disk. That's where we re-inject the self-evict
    // prelude and regenerate sw.js from the freshly written chunks.
    // Farm can fire several incremental updates in quick succession (e.g. a
    // template edit that recompiles multiple modules), each emitting its own
    // chunk set. Publish sw.js only after the burst settles so the browser sees
    // a single activation pointing at the final chunks instead of racing
    // several overlapping swaps. The self-evict injection stays immediate.
    // createBundleHandler owns the Compiler (exposed as serverOrCompiler), so
    // the debounced publish can recompute the chunk-graph manifest from the
    // freshly written resources on every rebuild.
    let compiler: any = null;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    const publishSW = () => {
      if (publishTimer) clearTimeout(publishTimer);
      publishTimer = setTimeout(async () => {
        publishTimer = null;
        try {
          if (compiler) {
            latestChunkGraphManifest = await computeChunkManifest(
              compiler,
              cwd,
              assetsDir
            );
          }
        } catch (err) {
          console.error("[bundle] watch chunk-graph manifest failed:", err);
        }
        onUpdate();
      }, 300);
    };
    resolvedConfig.jsPlugins = [
      ...(resolvedConfig.jsPlugins ?? []),
      {
        name: "sw-refresh",
        // Runs inside createCompiler (before the initial compile + every watch
        // rebuild), so the incremental writer is in place before the first
        // writeResourcesToDisk() and can seed its last-seen resource map.
        configureCompiler: (compiler) => {
          patchIncrementalWrite(compiler);
        },
        writeResources: {
          executor: () => {
            try {
              injectSelfEvicting(assetsDir);
              publishSW();
            } catch (err) {
              console.error("[bundle] watch refresh failed:", err);
            }
          },
        },
      },
    ];
    const watcher = await createBundleHandler(resolvedConfig, logger, true);
    compiler = (watcher as any).serverOrCompiler ?? null;
  } catch (err) {
    console.error("[bundle] Farm watch compile failed:", err);
  }
}
