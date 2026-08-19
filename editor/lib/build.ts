import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "fs"
import { Eta } from "eta"
import { parseKatexFormats, processKatexAssets } from "./build/katex"
import { compileAll } from "./build/templates"
import { buildIcons } from "./build/iconoir"
import { AppFunc, BuildMode, SUPPORTED_MODES, NAME_TO_BUILD_MODE } from "./build/build-mode"
import { EditorAction, EDITOR_ACTION_PREFIX } from "../src/config/enums/editor-action"
import { ToolbarAction, TOOLBAR_ACTION_PREFIX, toolbarActions } from "../src/config/enums/toolbar-action"
import { ToolbarCommand, TOOLBAR_CMD_PREFIX } from "../src/config/enums/toolbar-command"
import { SidebarAction, SIDEBAR_ACTION_PREFIX, sidebarActions } from "../src/config/enums/sidebar-action"
import { copyStaticAssets } from "./build/static"
import { renderShell } from "./build/shell"
import { writeThinShell, writeFullBundle } from "./build/thin"
import { compileStyles } from "./build/styles"
import { processProsekitCss } from "./build/prosekit-css"
import { runBundle, runBundleWatch, getChunkMap, pruneStaleChunks, getLatestChunkGraphManifest, computeAppHash, computeIndexHash, injectHashMeta } from "./build/bundle"

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
process.env.APP_VERSION ??= pkg.version

const renderTemplates = process.argv.includes("--render-templates")
const watch = process.argv.includes("--watch")

if (!watch || !existsSync(join(root, "src", "eta", "icons.ts"))) buildIcons()
const icons = await import("../src/eta/icons")
process.env.NODE_ENV = watch ? "development" : "production"
process.env.BUILD_MODE ??= "web-local"
const withMeta = process.argv.includes("--with-metafile")
const publicDir = join(root, "public")
mkdirSync(publicDir, { recursive: true })

const templatesSrc = join(root, "templates")
const eta = new Eta({ views: templatesSrc, autoTrim: [false, false] })

const SELF_BASE = (process.env.EDITOR_SELF_BASE || "").replace(/\/+$/, "")
// Path prefix for page assets when the editor deploys under a self base
// (web-remote subpath); empty when the page lives at its own origin root
// (web-local, gui-desktop, gui-mobile), where relative URLs are correct.
// Derived here so templates stay declarative — no string sanitization in Eta.
const ASSET_BASE = SELF_BASE ? `${SELF_BASE}/` : ""
const modeStr = process.env.BUILD_MODE || "web-local"
const modeNum = NAME_TO_BUILD_MODE[modeStr] ?? BuildMode.WebLocal
// FullBundle ships the complete local bundle: a thin shell is simply the
// absence of FullBundle (GuiMobile only), so full builds write the full
// public/ instead of the thin boot set, and UPDATE_BASE empties so the build
// carries every chunk and never fetches remotely. Default-on for web-local
// (`bun dev` — a full self-contained bundle that updates from itself),
// web-remote (the SW serves the whole public/) and gui-desktop (read-only
// install payload); gui-mobile stays thin-shell + remote update.
const hasFlag = (func: AppFunc): boolean => !!(SUPPORTED_MODES[func] & modeNum)
const fullBundle = hasFlag(AppFunc.FullBundle)

// The remote deployment of public/ that fetch transports pull the live editor
// from (Part C.1). Defaults to the GitHub Pages live URL, mode-aware so a
// gui-desktop/gui-mobile build resolves its own deployment subdir (desktop →
// /desktop, mobile → /mobile) without static.yml having to pass UPDATE_BASE.
// An explicit UPDATE_BASE always wins (per-mode CI override).
const LIVE_BASE = "https://10per5.github.io/inb4doc/editor-live"
const MODE_UPDATE_SUBDIR: Partial<Record<BuildMode, string>> = {
  [BuildMode.GuiDesktop]: "/desktop",
  [BuildMode.GuiMobile]: "/mobile",
}
// An explicit UPDATE_BASE always wins (per-mode CI override). FullBundle
// overrides both: an empty base disables the fetch updater entirely.
const UPDATE_BASE = (
  fullBundle ? "" : process.env.UPDATE_BASE || `${LIVE_BASE}${MODE_UPDATE_SUBDIR[modeNum] ?? ""}`
).replace(/\/+$/, "")

const criticalCss = [
  readFileSync(join(__dir, "style", "layout.css"), "utf-8"),
  readFileSync(join(__dir, "style", "loading.css"), "utf-8"),
].join("\n")

const context = {
  BUILD_MODE: modeStr,
  criticalCss,
  EDITOR_SELF_BASE: SELF_BASE,
  ASSET_BASE,
  LIVE_URL_BASE: process.env.LIVE_URL_BASE || "",
  UPDATE_BASE,
  APP_VERSION: process.env.APP_VERSION || "",
  DEBUG_LOGGING: process.env.DEBUG_LOGGING === "1",
  EDITOR_ACTION_PREFIX,
  editorAction: EditorAction,
  TOOLBAR_ACTION_PREFIX,
  ToolbarAction,
  toolbarActions,
  TOOLBAR_CMD_PREFIX,
  ToolbarCommand,
  SIDEBAR_ACTION_PREFIX,
  SidebarAction,
  sidebarActions,
  icons: icons as Record<string, string>,
  mobileCss: hasFlag(AppFunc.MobileCss),
  toolbarQuickNav: hasFlag(AppFunc.ToolbarQuickNav),
  thinShell: !fullBundle,
  mobileDock: hasFlag(AppFunc.MobileDock),
  // The dock layout replaces the desktop chrome (sidebar + meta aside) only on
  // gui-mobile. Web-local ships the dock markup too, but keeps sidebar/meta so
  // the desktop viewport (mobileDock off at runtime) shows the full chrome.
  dockReplacesChrome: modeNum === BuildMode.GuiMobile,
  webAdaptive: modeNum === BuildMode.WebLocal || modeNum === BuildMode.WebRemote,
}

const html = renderShell(eta, templatesSrc, context as Record<string, unknown>)
writeFileSync(join(publicDir, "index.html"), html)

const styleFlags = {
  BUILD_MODE: modeStr,
  mobileCss: hasFlag(AppFunc.MobileCss),
  mobileDock: hasFlag(AppFunc.MobileDock),
  dockReplacesChrome: modeNum === BuildMode.GuiMobile,
  webAdaptive: modeNum === BuildMode.WebLocal || modeNum === BuildMode.WebRemote,
}
compileStyles(eta, templatesSrc, join(root, "src", "eta", "styles"), styleFlags)

const templateCount = compileAll(templatesSrc, join(root, "src", "eta"), {
  desktopBridge: hasFlag(AppFunc.DesktopBridge),
  mobileBridge: hasFlag(AppFunc.MobileBridge),
  thinShell: !fullBundle,
})
if (templateCount > 0) console.log(`[build] Compiled ${templateCount} runtime template(s)`)

if (!renderTemplates) {
  copyStaticAssets(join(root, "static"), publicDir)

  const assetsDir = join(publicDir, "assets")
  // Root-absolute only locally; under EDITOR_SELF_BASE every SW/chunk URL is
  // prefixed with the deployed base so the live site works off a subpath.
  const BASE = SELF_BASE ? `${SELF_BASE}/` : "/"
  const SW_PREFIX = `${SELF_BASE}/assets`

  // buildVersion feeds the SW_ACTIVATED version guard in sw-registrar-service.ts, which
  // drops activations older than the last applied one. The counter must stay
  // monotonic ACROSS dev-server restarts (it lives in a process-local variable
  // otherwise, so a fresh `bun dev` would start at 1 again and get ignored by
  // pages that already saw a higher version). Seed it from the sw.js on disk.
  function readExistingBuildVersion(): number {
    const swPath = join(publicDir, "sw.js")
    if (!existsSync(swPath)) return 0
    try {
      const m = readFileSync(swPath, "utf-8").match(/^\/\/ build: (\d+)/m)
      return m ? parseInt(m[1], 10) : 0
    } catch {
      return 0
    }
  }

  let buildVersion = readExistingBuildVersion()

  // appHash/indexHash live in <meta> tags so a page can tell, on a later SW
  // activation, whether the build it booted from changed the entry pot or the
  // shell — the two things a hot swap can never apply. index-hash is computed
  // on the html with the injected metas (and the emitted-css link list) removed,
  // so an unrelated rebuild (a rotated chunk or css filename) keeps a stable
  // index-hash and only structural shell edits move it. build-version is the
  // generation marker the page booted with; it lets the registrar skip the
  // entry/shell reload for activations of the same generation (rebuild churn),
  // while a real entry/shell change always ships a newer marker.
  function writeHashMetas(appHash: string, buildVersion: number): string {
    const indexPath = join(publicDir, "index.html")
    let html = readFileSync(indexPath, "utf8")
    html = injectHashMeta(html, "app-hash", appHash)
    const indexHash = computeIndexHash(html)
    html = injectHashMeta(html, "index-hash", indexHash)
    html = injectHashMeta(html, "build-version", String(buildVersion))
    writeFileSync(indexPath, html)
    return indexHash
  }

  function generateSWFiles() {
    buildVersion++
    pruneStaleChunks(root, assetsDir)
    const allFiles = readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
      .map((f) => `${SW_PREFIX}/${f}`)
    const important = [BASE, `${SW_PREFIX}/app.js`, `${SW_PREFIX}/prosekit-style.css`, `${SW_PREFIX}/prosekit-typography.css`, `${SW_PREFIX}/katex.css`, `${BASE}favicon.png`, `${BASE}inb4doc-256.png`, `${BASE}inb4doc-512.png`, `${BASE}manifest.json`]
    // Watch mode precaches the same chunk set so an edited controller's new
    // chunk is part of the SW-install transfer (and shows up in the loader).
    // Cache-skip in the SW makes re-installs transfer only the changed files.
    const chunks = allFiles.filter((f) => !important.includes(f))

    const chunkMap = getChunkMap(root, SW_PREFIX)

    const appHash = computeAppHash(assetsDir)
    const indexHash = writeHashMetas(appHash, buildVersion)
    const manifest = getLatestChunkGraphManifest() ?? {
      affectedBy: {},
      coldOnChange: {},
    }

    const swAssets = eta.renderString(readFileSync(join(templatesSrc, "sw-assets.eta"), "utf-8"), {
      important,
      chunks,
      appHash,
      indexHash,
      affectedBy: manifest.affectedBy,
      coldOnChange: manifest.coldOnChange,
    })
    writeFileSync(join(publicDir, "assets", "sw-assets.js"), swAssets)

    // First-class JSON twin of sw-assets.js so fetch transports (GuiDesktop
    // thin shell) get the same file/version data without eval'ing the SW
    // script. The live deployment serves public/, so the URL
    // ${UPDATE_BASE}/assets/manifest.json is valid.
    const jsonManifest = {
      buildVersion,
      appHash,
      indexHash,
      affectedBy: manifest.affectedBy,
      coldOnChange: manifest.coldOnChange,
      important,
      chunks,
      chunkMap,
    }
    writeFileSync(join(publicDir, "assets", "manifest.json"), JSON.stringify(jsonManifest))

    const swJs = eta.renderString(readFileSync(join(templatesSrc, "sw.eta"), "utf-8"), {
      buildVersion, chunkMap, isDev: watch, appVersion: process.env.APP_VERSION || "",
      swAssetsUrl: `${SW_PREFIX}/sw-assets.js`,
      // Only cache source maps in dev/watch (where they're emitted) and on
      // WebLocal builds; remote/deployed builds never ship maps, so the SW
      // shouldn't hold onto them either.
      cacheMaps: Boolean(watch) || modeStr === "web-local",
    })
    writeFileSync(join(publicDir, "sw.js"), swJs)

    // Thin-shell install set (a non-FullBundle build — GuiMobile): the core
    // boot set only, fetched editor is downloaded on first run. Must run after
    // generateSWFiles() so manifest.json/sw-assets.js carry this build's data.
    // FullBundle builds ship the complete public/ instead (all chunks served
    // locally, no updater).
    if (!fullBundle) {
      writeThinShell(publicDir, join(root, "dist"))
    } else {
      writeFullBundle(publicDir, join(root, "dist"))
    }
  }

  function linkEmittedCss() {
    const cssFiles = readdirSync(assetsDir)
      .filter((f) => f.endsWith(".css"))
      .filter((f) => f !== "katex.css" && f !== "prosekit-style.css" && f !== "prosekit-typography.css")
      .sort()
    if (cssFiles.length === 0) return
    const indexPath = join(publicDir, "index.html")
    const html = readFileSync(indexPath, "utf-8")
    const links = cssFiles.map((f) => `    <link rel="stylesheet" href="assets/${f}" />`).join("\n")
    writeFileSync(indexPath, html.replace("</head>", `${links}\n  </head>`))
    console.log(`[build] Linked emitted CSS: ${cssFiles.join(", ")}`)
  }

  if (watch) {
    rmSync(assetsDir, { recursive: true, force: true })
    mkdirSync(assetsDir, { recursive: true })
    processProsekitCss({ publicDir })
    await runBundleWatch(root, generateSWFiles)
  } else {
    const result = await runBundle({ cwd: root, dev: false, withMeta })
    if (result.exitCode !== 0) process.exit(result.exitCode)
    linkEmittedCss()
    processProsekitCss({ publicDir })
    generateSWFiles()
  }

  const katexFontsArg = process.argv.find((a) => a.startsWith("--katex-fonts="))
  const formats = parseKatexFormats(katexFontsArg?.split("=")[1])
  processKatexAssets({ publicDir, formats })
}
