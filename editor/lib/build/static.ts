import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs"
import { join } from "path"

export function copyStaticAssets(staticDir: string, publicDir: string): void {
  mkdirSync(publicDir, { recursive: true })
  for (const name of readdirSync(staticDir)) {
    if (name.startsWith(".")) continue
    const src = join(staticDir, name)
    if (statSync(src).isDirectory()) continue
    if (name.endsWith(".html")) continue
    copyFileSync(src, join(publicDir, name))
  }
}
