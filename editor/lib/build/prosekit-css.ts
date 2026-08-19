import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, "..", "..");

export interface ProsekitCssOptions {
  publicDir: string;
}

/**
 * Copies ProseKit base + typography CSS from node_modules into public/assets/
 * as standalone files. Farm bundles CSS imported in JS into <style> tags inside
 * JS chunks — it does NOT emit separate .css files. These must exist as
 * real files on disk so the HTML <link> tags and the SW can cache them.
 *
 * Replaces the old processThemeNordAssets (Milkdown era).
 */
export function processProsekitCss(opts: ProsekitCssOptions) {
  const { publicDir } = opts;
  const assetsDir = join(publicDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const files: Array<[string, string]> = [
    ["style.css", "prosekit-style.css"],
    ["typography.css", "prosekit-typography.css"],
  ];

  for (const [srcName, dstName] of files) {
    const src = join(rootDir, "node_modules", "@prosekit", "basic", "dist", srcName);
    const dst = join(assetsDir, dstName);
    const css = readFileSync(src, "utf-8").trim();
    writeFileSync(dst, css);
    console.log(`[prosekit-css] ${dstName} (${css.length} bytes)`);
  }
}
