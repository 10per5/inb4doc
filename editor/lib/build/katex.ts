/// <reference types="bun" />
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, "..", "..");

export interface KatexOptions {
  publicDir: string;
  formats: string[];
}

export function parseKatexFormats(raw: string | undefined): string[] {
  const v = raw ?? "woff2";
  if (v.toLowerCase() === "all") return ["woff2", "woff", "ttf"];
  return v.split(",").map(s => s.trim().toLowerCase());
}

export function processKatexAssets(opts: KatexOptions) {
  const { publicDir, formats } = opts;
  const keepWoff2 = formats.includes("woff2");
  const keepWoff = formats.includes("woff");
  const keepTtf = formats.includes("ttf");

  const katexCssSrc = join(rootDir, "node_modules", "katex", "dist", "katex.min.css");
  const katexCssDst = join(publicDir, "assets", "katex.css");
  const katexFontDir = join(rootDir, "node_modules", "katex", "dist", "fonts");
  const fontsDst = join(publicDir, "assets", "fonts");

  let css = readFileSync(katexCssSrc, "utf-8");

  if (!keepWoff) {
    css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, "");
  }
  if (!keepTtf) {
    css = css.replace(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, "");
  }

  writeFileSync(katexCssDst, css);

  mkdirSync(fontsDst, { recursive: true });
  const fontExts: string[] = [];
  if (keepWoff2) fontExts.push(".woff2");
  if (keepWoff) fontExts.push(".woff");
  if (keepTtf) fontExts.push(".ttf");
  for (const name of readdirSync(katexFontDir)) {
    if (fontExts.some((ext) => name.endsWith(ext))) {
      copyFileSync(join(katexFontDir, name), join(fontsDst, name));
    }
  }

  console.log(`KaTeX CSS: ${katexCssDst} (fonts: ${formats.join(", ")})`);
}
