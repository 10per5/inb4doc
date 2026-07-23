/// <reference types="bun" />
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { Eta } from "eta";
import { parseKatexFormats, processKatexAssets } from "./lib/build/katex";
import { compileAll } from "./lib/build/templates";
import { AppFunc, BuildMode, SUPPORTED_MODES, NAME_TO_BUILD_MODE } from "./lib/build/build-mode";
import { EditorAction, EDITOR_ACTION_PREFIX } from "./src/config/enums/editor-action";
import { ToolbarAction, TOOLBAR_ACTION_PREFIX, toolbarActions } from "./src/config/enums/toolbar-action";
import { ToolbarCommand, TOOLBAR_CMD_PREFIX } from "./src/config/enums/toolbar-command";
import { SidebarAction, SIDEBAR_ACTION_PREFIX, sidebarActions } from "./src/config/enums/sidebar-action";
import * as icons from "./src/components/ui/icons";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dir, "package.json"), "utf-8"));
process.env.APP_VERSION ??= pkg.version;
const watch = process.argv.includes("--watch");
process.env.NODE_ENV = watch ? "development" : "production";
process.env.BUILD_MODE ??= "web-local";
const withMeta = process.argv.includes("--with-metafile");
const publicDir = join(__dir, "public");

// Copy static assets (non-HTML files) to public
const staticDir = join(__dir, "static");
mkdirSync(publicDir, { recursive: true });
for (const name of readdirSync(staticDir)) {
  if (name.startsWith(".")) continue;
  const src = join(staticDir, name);
  if (statSync(src).isDirectory()) continue;
  // Skip index.html — it's now generated from shell.eta
  if (name.endsWith(".html")) continue;
  copyFileSync(src, join(publicDir, name));
}

// Render shell.eta → public/index.html using Eta
const templatesSrc = join(__dir, "templates");
const eta = new Eta({ views: templatesSrc });
const shellSource = readFileSync(join(templatesSrc, "shell.eta"), "utf-8");

const SELF_BASE = (process.env.EDITOR_SELF_BASE || ".").replace(/\/+$/, "");

const modeStr = process.env.BUILD_MODE || "web-local";
const modeNum = NAME_TO_BUILD_MODE[modeStr] ?? BuildMode.WebLocal;
const hasFlag = (func: AppFunc): boolean => !!(SUPPORTED_MODES[func] & modeNum);

const html = eta.renderString(shellSource, {
  BUILD_MODE: modeStr,
  EDITOR_SELF_BASE: SELF_BASE,
  LIVE_URL_BASE: process.env.LIVE_URL_BASE || "",
  APP_VERSION: process.env.APP_VERSION || "",
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
  icons,
});

writeFileSync(join(publicDir, "index.html"), html);

// Compute build-time flags for styles
const etaFlags = {
  BUILD_MODE: modeStr,
  mobileCss: hasFlag(AppFunc.MobileCss),
};

// Auto-render .eta files in src/styles/ → .css (consumed by Bun bundle)
const stylesDir = join(__dir, "src", "styles");
for (const name of readdirSync(stylesDir)) {
  if (!name.endsWith(".eta")) continue;
  const source = readFileSync(join(stylesDir, name), "utf-8");
  const rendered = eta.renderString(source, etaFlags);
  writeFileSync(join(stylesDir, name.replace(".eta", ".css")), rendered);
}

// Pre-compile runtime .eta templates → generated .ts modules under src/eta/
const templateCount = compileAll(templatesSrc, join(__dir, "src", "eta"));
if (templateCount > 0) console.log(`[build] Compiled ${templateCount} runtime template(s)`);

const args = [
  "build",
  "src/app.ts",
  "--outdir",
  "public/assets",
  "--splitting",
  "--define",
  "__VUE_OPTIONS_API__=true",
  "--define",
  "__VUE_PROD_DEVTOOLS__=false",
  "--define",
  "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__=false",
];
if (!watch) args.splice(4, 0, "--minify");
if (withMeta) args.push("--metafile-md=/tmp/opencode/bundle-report.md");
if (watch) args.push("--watch");

const result = Bun.spawnSync(["bun", ...args], {
  cwd: __dir,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
  },
});
if (result.exitCode !== 0) process.exit(result.exitCode);

const katexFontsArg = process.argv.find((a) => a.startsWith("--katex-fonts="));
const formats = parseKatexFormats(katexFontsArg?.split("=")[1]);
processKatexAssets({ publicDir, formats });
