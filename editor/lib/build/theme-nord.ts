import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, "..", "..");

export interface ThemeNordOptions {
  publicDir: string;
}

export function processThemeNordAssets(opts: ThemeNordOptions) {
  const { publicDir } = opts;
  const src = join(rootDir, "node_modules", "@milkdown", "theme-nord", "lib", "style.css");
  const dst = join(publicDir, "assets", "theme-nord.css");

  let css = readFileSync(src, "utf-8");
  css = css.replace(/\/\*\$vite\$:[0-9]+\*\//g, "").trim();

  mkdirSync(join(publicDir, "assets"), { recursive: true });
  writeFileSync(dst, css);

  console.log(`ThemeNord CSS: ${dst} (${css.length} bytes)`);
}
