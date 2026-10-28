/**
 * Import name resolution — keeping an imported file from taking over something
 * that is already there.
 *
 * Two collisions matter, and they are not the same problem:
 *
 * 1. **File vs directory.** A folder already owns that name (`inb4doc`) and the
 *    filesystem cannot hold both, so an imported `inb4doc.md` used to silently
 *    overtake the folder. It is renamed to `inb4doc-file` instead — once, and
 *    forever after subsequent imports of the same name land on that same
 *    companion file, which is why it keeps a stable suffix rather than an
 *    incrementing number.
 * 2. **File vs file.** That is a real conflict with three reasonable answers, so
 *    it is the user's call: replace, append, or merge (see `applyImportBody`).
 */

import type { ZipEntry } from "@/utils/zip";
import { getProvider } from "@/stores/provider-store";

export type ImportExistingMode = "replace" | "append" | "merge";

export interface ResolvedImport {
  /** Source entry from the archive. */
  entry: ZipEntry;
  /** Path inside the content tree (no `.md`). */
  path: string;
  /** Set when a directory forced the name aside. */
  renamedFrom?: string;
  /** Whether the path is an existing FILE (so `mode` applies). */
  exists: boolean;
  mode: ImportExistingMode;
}

/** Every path that owns descendants — i.e. every directory in the tree. */
export function collectDirPaths(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

/**
 * Resolve where an imported file may land. A directory of the same name never
 * gets overtaken: the file becomes `<name>-file` (and `-file-2` on the wildly
 * improbable chance that is taken too).
 */
export function resolveImportPath(
  requested: string,
  dirs: Set<string>,
  files: Set<string>,
): { path: string; renamedFrom?: string } {
  if (!dirs.has(requested)) return { path: requested };

  let candidate = `${requested}-file`;
  let n = 2;
  while (dirs.has(candidate) || files.has(candidate)) {
    candidate = `${requested}-file-${n}`;
    n++;
  }
  return { path: candidate, renamedFrom: requested };
}

/**
 * The body to write for an existing file, per the chosen strategy.
 *
 * - replace — the imported body wins outright.
 * - append — the imported content is added under the existing content.
 * - merge — a real 3-way line merge with an empty ancestor: lines both sides
 *   share are kept once, genuinely new lines from either side are brought in.
 *   (`merge3` is the same LCS engine the per-section formatting merge uses, so
 *   it aligns on content, not on line numbers.)
 */
export async function applyImportBody(
  existing: string,
  imported: string,
  mode: ImportExistingMode,
): Promise<string> {
  if (mode === "replace") return imported;
  if (mode === "append") {
    const gap = existing.endsWith("\n") || existing === "" ? "\n" : "\n\n";
    return `${existing}${gap}${imported}`;
  }
  const { merge3 } = await import("@/utils/merge3");
  return merge3("", existing, imported).merged;
}

/** What an import should do with each selected archive entry. */
export function resolveImports(
  entries: ZipEntry[],
  treePaths: Iterable<string>,
  mode: ImportExistingMode,
): ResolvedImport[] {
  const files = new Set(treePaths);
  const dirs = collectDirPaths(files);
  return entries.map((entry) => {
    const requested = entry.relPath.replace(/\.md$/, "");
    const { path, renamedFrom } = resolveImportPath(requested, dirs, files);
    return {
      entry,
      path,
      renamedFrom,
      exists: files.has(path),
      mode,
    };
  });
}

/** Read a file's current body from disk (empty string when unreadable). */
export async function readExistingBody(path: string): Promise<string> {
  try {
    const raw = await getProvider().readFile(path);
    return raw ?? "";
  } catch {
    return "";
  }
}
