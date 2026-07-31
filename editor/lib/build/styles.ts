import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"
import { Eta } from "eta"

export interface StyleFlags {
  BUILD_MODE: string
  mobileCss: boolean
}

export function compileStyles(eta: Eta, templatesSrc: string, outDir: string, flags: StyleFlags): void {
  const stylesEtaDir = join(templatesSrc, "styles")
  mkdirSync(outDir, { recursive: true })
  const parts: string[] = []
  for (const name of readdirSync(stylesEtaDir)) {
    if (!name.endsWith(".eta")) continue
    const source = readFileSync(join(stylesEtaDir, name), "utf-8")
    const rendered = eta.renderString(source, flags)
    if (rendered.trim()) parts.push(rendered)
  }
  writeFileSync(join(outDir, "conditions.css"), parts.join("\n"))
}
