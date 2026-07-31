import { readFileSync } from "fs"
import { join } from "path"
import { Eta } from "eta"

export function renderShell(eta: Eta, templatesSrc: string, context: Record<string, unknown>): string {
  const shellSource = readFileSync(join(templatesSrc, "shell.eta"), "utf-8")
  return eta.renderString(shellSource, context)
}
