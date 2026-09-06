import { join } from "path"
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync, cpSync } from "fs"

// Part C.1 thin-shell packaging: a non-FullBundle build (GuiMobile) ships only
// the core boot set + updater. The first run downloads the live editor into the
// writable data dir; the install copy is read-only and never written back.
// FullBundle builds always ship the full public/, so only non-FullBundle builds
// call this.
//
// Core set = index.html, sw.js, the SW's asset inventory (sw-assets.js +
// manifest.json), the entry pot (app.js + __farm_runtime.js), every emitted css
// (katex + rotated styles-*.css), and the static icons/manifest the
// shell references. The eager core chunk set (everything app.js statically
// imports — the shell/controller/service/domain pots) ships here too; Part D's
// lazy editor means node_imports/editor/dialog chunks are NOT in this set and
// are delivered by the first-run updater instead.
export function writeThinShell(publicDir: string, outDir: string): void {
  const assetsDir = join(publicDir, "assets")
  const outAssets = join(outDir, "assets")
  // dist/ is a pure copy of one build's output — rebuild it fresh so stale
  // chunks from an earlier mode (e.g. the mobile bridge from a prior
  // gui-desktop build) never ship in the thin shell / APK.
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  mkdirSync(outAssets, { recursive: true })

  const copy = (src: string, dest: string): void => {
    if (!existsSync(src)) {
      console.warn(`[thin] missing core asset, skipping: ${src}`)
      return
    }
    copyFileSync(src, dest)
  }

  copy(join(publicDir, "index.html"), join(outDir, "index.html"))
  copy(join(publicDir, "sw.js"), join(outDir, "sw.js"))
  copy(join(assetsDir, "sw-assets.js"), join(outAssets, "sw-assets.js"))
  copy(join(assetsDir, "manifest.json"), join(outAssets, "manifest.json"))
  copy(join(assetsDir, "app.js"), join(outAssets, "app.js"))
  copy(join(assetsDir, "__farm_runtime.js"), join(outAssets, "__farm_runtime.js"))

  // The eager boot set: every chunk app.js statically imports. Parsing the
  // entry keeps the thin set in lockstep with the pot split without a second
  // source of truth — the moment a pot stops being statically imported (Part
  // D's lazy editor), it drops out of this list and off the shipped disk.
  const appJs = readFileSync(join(assetsDir, "app.js"), "utf-8")
  const eager = new Set<string>()
  for (const m of appJs.matchAll(/import\s+"\.\/([^"?]+)"/g)) {
    eager.add(m[1])
  }
  for (const name of eager) {
    copy(join(assetsDir, name), join(outAssets, name))
  }
  if (eager.size > 0) {
    console.log(`[thin] shipped ${eager.size} eager chunk(s)`)
  }

  for (const f of readdirSync(assetsDir)) {
    if (f.endsWith(".css")) copy(join(assetsDir, f), join(outAssets, f))
  }

  // Static icons + web app manifest referenced by index.html / sw precache.
  for (const f of readdirSync(publicDir)) {
    if (
      f.endsWith(".png") ||
      f === "manifest.json" ||
      f === "favicon.ico" ||
      f === "favicon.svg"
    ) {
      copy(join(publicDir, f), join(outDir, f))
    }
  }

  console.log(`[thin] wrote ${outDir}`)
}

// FullBundle counterpart to writeThinShell: dist/ carries the complete
// public/ — index.html, every chunk (including Part D's lazy editor /
// node_imports / dialog pots), all css, sw.js, and the static icons. The
// Android assets/editor/ dir is built from this, so the APK serves every
// resource locally with nothing to fetch. sw.js / assets/manifest.json are
// inert here (the SW never registers under file:// and the empty update-base
// disables the fetch updater), but keeping a pure copy costs nothing.
export function writeFullBundle(publicDir: string, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true })
  cpSync(publicDir, outDir, { recursive: true })
  console.log(`[thin] wrote full bundle to ${outDir}`)
}
