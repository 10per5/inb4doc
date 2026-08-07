/**
 * build-templates.ts — Pre-compile .eta templates to .ts modules.
 *
 * Walks the template SOURCE directory (excluding partials/ and shell.eta,
 * which are compile-time-only includes) and writes a plain .ts render-module
 * per template into the generated output directory (e.g. src/eta/).
 * The Eta compiler never ships to the browser.
 */
import { Eta } from "eta";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from "fs";
import { join, relative, basename, dirname, sep } from "path";

/**
 * Returns a POSIX-style relative path (forward slashes) from `base` to `target`.
 * Used to normalize OS-specific paths so compiled-template IDs are portable.
 */
function toPosixRelativePath(base: string, target: string): string {
  return relative(base, target).split(sep).join("/");
}

function toPascalCase(str: string): string {
  return str.replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toUpperCase());
}

/**
 * Emit src/eta/updater-core.ts from templates/partials/updater-core.eta.
 *
 * updater-core.eta is a build-time partial inlined verbatim into sw.js (the SW
 * transport) — but it is also the shared source for the page/desktop/mobile
 * updaters (Part C). It contains pure functions and NO Eta template tags, so the
 * compiled module is simply the raw source with an export line appended: the SW
 * and the page execute byte-identical logic (no duplication).
 */
function compileUpdaterCore(partialsDir: string, outDir: string): boolean {
  const srcPath = join(partialsDir, "updater-core.eta");
  if (!existsSync(srcPath)) return false;
  const raw = readFileSync(srcPath, "utf-8");
  const code = `// AUTO-GENERATED from partials/updater-core.eta — do not edit manually
// @ts-nocheck
${raw}
export { updaterDiff, updaterTransfer, updaterFetch, isStaleVersion };
`;
  const tsPath = join(outDir, "updater-core.ts");
  const existing = existsSync(tsPath) ? readFileSync(tsPath, "utf-8") : null;
  if (existing === code) return false;
  writeFileSync(tsPath, code);
  return true;
}

/**
 * Emit src/eta/bridge.ts from templates/partials/bridge.eta.
 *
 * bridge.eta IS an Eta template: it renders the native-bridge initializer for
 * the ACTIVE build mode at compile time, so the import + call for the unused
 * host bridge never appear in the emitted module at all — no runtime hasFunc
 * gate, and the dead bridge module is absent from the bundle (Part D).
 */
function compileBridge(
  templatesSrc: string,
  outDir: string,
  flags: TemplateFlags
): boolean {
  const srcPath = join(templatesSrc, "partials", "bridge.eta");
  if (!existsSync(srcPath)) return false;
  const source = readFileSync(srcPath, "utf-8");
  const rendered = new Eta().renderString(source, flags);
  const code = `// AUTO-GENERATED from partials/bridge.eta — do not edit manually
// @ts-nocheck
${rendered}`;
  const tsPath = join(outDir, "bridge.ts");
  const existing = existsSync(tsPath) ? readFileSync(tsPath, "utf-8") : null;
  if (existing === code) return false;
  writeFileSync(tsPath, code);
  return true;
}

export interface TemplateFlags {
  desktopBridge: boolean;
  mobileBridge: boolean;
}

/**
 * @param srcDir   raw .eta template sources (e.g. editor/templates)
 * @param outDir   generated .ts modules (e.g. editor/src/eta)
 * @param flags    build-mode flags for mode-conditional templates (bridge.eta)
 * @returns number of compiled templates
 */
export function compileAll(
  srcDir: string,
  outDir: string,
  flags: TemplateFlags = { desktopBridge: false, mobileBridge: false }
): number {
  const eta = new Eta({ views: srcDir });
  let count = 0;

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "partials") {
          // compile partials/menu/ subdirectory as runtime .ts modules
          const partialsDir = join(dir, entry.name);
          const menuDir = join(partialsDir, "menu");
          try { walk(menuDir); } catch { /* no menu partials */ }
          // the shared updater core is compiled as raw source (see above)
          if (compileUpdaterCore(partialsDir, outDir)) count++;
          // the mode-conditional native-bridge initializer (see above)
          if (compileBridge(srcDir, outDir, flags)) count++;
          continue;
        }
        if (entry.name === "styles") continue; // build-time-only CSS templates
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith(".eta")) continue;
      if (entry.name === "shell.eta" || entry.name === "sw-assets.eta" || entry.name === "sw.eta") continue; // compile-time only, rendered by build.ts

      const etaPath = join(dir, entry.name);
      const relPath = toPosixRelativePath(srcDir, etaPath);
      const source = readFileSync(etaPath, "utf-8");

      const compiled = eta.compile(source);
      const fnStr = compiled.toString();

      const moduleName = basename(entry.name, ".eta");
      const pascalName = toPascalCase(moduleName);
      // strip "partials/" prefix so partials compile to src/eta/menu/ not src/eta/partials/menu/
      const outRelPath = relPath.startsWith("partials/") ? relPath.slice("partials/".length) : relPath;
      const destDir = join(outDir, dirname(outRelPath));
      mkdirSync(destDir, { recursive: true });
      const tsPath = join(destDir, moduleName + ".ts");

      const isMenuPartial = relPath.startsWith("partials/menu/");
      const typeImport = isMenuPartial
        ? `import type { MenuRenderData } from "@/components/ui/menu";`
        : "";
      const paramType = isMenuPartial ? "MenuRenderData" : "Record<string, unknown>";

      const code = `// AUTO-GENERATED from ${relPath} — do not edit manually
// @ts-nocheck
${typeImport}
import { Eta } from "eta";
const __eta = new Eta();
const __compiled = ${fnStr};

export default function render(data: ${paramType}): string {
  return __compiled.call(__eta, data);
}

export { render as render${pascalName} };
`;

      const existing = existsSync(tsPath) ? readFileSync(tsPath, "utf-8") : null;
      if (existing === code) continue;
      writeFileSync(tsPath, code);
      count++;
    }
  }

  walk(srcDir);
  return count;
}
