/**
 * build-templates.ts — Pre-compile .eta templates to .ts modules.
 *
 * Walks the template SOURCE directory (excluding partials/ and shell.eta,
 * which are compile-time-only includes) and writes a plain .ts render-module
 * per template into the generated output directory (e.g. src/eta/).
 * The Eta compiler never ships to the browser.
 */
import { Eta } from "eta";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from "fs";
import { join, relative, basename, dirname } from "path";

function toPascalCase(str: string): string {
  return str.replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toUpperCase());
}

/**
 * @param srcDir   raw .eta template sources (e.g. editor/templates)
 * @param outDir   generated .ts modules (e.g. editor/src/eta)
 * @returns number of compiled templates
 */
export function compileAll(srcDir: string, outDir: string): number {
  const eta = new Eta({ views: srcDir });
  let count = 0;

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "partials") {
          // compile partials/menu/ subdirectory as runtime .ts modules
          const menuDir = join(dir, entry.name, "menu");
          try { walk(menuDir); } catch { /* no menu partials */ }
          continue;
        }
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith(".eta")) continue;
      if (entry.name === "shell.eta") continue; // compile-time only, rendered by build.ts

      const etaPath = join(dir, entry.name);
      const relPath = relative(srcDir, etaPath);
      const source = readFileSync(etaPath, "utf-8");

      const compiled = eta.compile(source);
      const fnStr = compiled.toString();

      const moduleName = basename(entry.name, ".eta");
      const pascalName = toPascalCase(moduleName);
      // strip "partials/" prefix so partials compile to src/eta/menu/ not src/eta/partials/menu/
      const outRelPath = relPath.replace(/^partials\//, "");
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

      writeFileSync(tsPath, code);
      count++;
    }
  }

  walk(srcDir);
  return count;
}
