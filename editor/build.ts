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
import { interpolateHtml } from "./lib/interpolate";
import { parseKatexFormats, processKatexAssets } from "./lib/katex";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dir, "package.json"), "utf-8"));
process.env.APP_VERSION ??= pkg.version;
const watch = process.argv.includes("--watch");
process.env.NODE_ENV = watch ? "development" : "production";
const withMeta = process.argv.includes("--with-metafile");
const publicDir = join(__dir, "public");

// Copy static files to public, interpolating env vars in HTML
const staticDir = join(__dir, "static");
mkdirSync(publicDir, { recursive: true });
for (const name of readdirSync(staticDir)) {
  if (name.startsWith(".")) continue;
  const src = join(staticDir, name);
  if (statSync(src).isDirectory()) continue;
  const dst = join(publicDir, name);
  if (name.endsWith(".html")) {
    const html = readFileSync(src, "utf-8");
    writeFileSync(dst, interpolateHtml(html));
  } else {
    copyFileSync(src, dst);
  }
}

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
