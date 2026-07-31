/// <reference types="bun" />
import { watch, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { stdin as input, stdout as output } from "process"
import readline from "node:readline/promises"
import { compileAll } from "./build/templates"

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, "..")
const TEMPLATES_DIR = join(root, "templates")
const ETA_OUT = join(root, "src", "eta")

// ── Leftover-process guard ───────────────────────────────────────────
// A stale `build.ts --watch` / `serve.ts` / `dev.ts` left over from a previous
// session (hard-killed terminal, separate `build:watch` run, …) will fight the
// new server over public/sw.js and port 3000, producing exactly the stale-swap
// chaos we've been chasing. Recycle leftovers before starting, with a Y/n
// confirm when there's a terminal to ask.

const LEFTOVER_RE = /(?:^|[\s/])(?:dev|serve)\.ts(?:$|\s)|build\.ts\b[^&|;]*--watch\b/

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Start tick (field 22) of a process, or null when /proc is unavailable
// (macOS/Windows). A leftover dev process must have started BEFORE us, so any
// candidate with a start tick >= ours is either this very process or a child —
// never a conflict to recycle.
function procStartTick(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8")
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2)
    const fields = afterComm.split(" ")
    const start = parseInt(fields[19], 10) // field 22 overall (state=3, ppid=4, …)
    return isFinite(start) ? start : null
  } catch {
    return null
  }
}

function ancestorPids(): Set<number> {
  const set = new Set<number>()
  let pid = process.ppid
  for (let i = 0; pid > 1 && !set.has(pid) && i < 64; i++) {
    set.add(pid)
    const out = Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)], {
      stdout: "pipe",
      stderr: "pipe",
    })
      .stdout.toString()
      .trim()
    const n = parseInt(out, 10)
    pid = isFinite(n) ? n : 0
  }
  return set
}

function findLeftovers(): number[] {
  try {
    const selfTick = procStartTick(process.pid)
    const ancestors = ancestorPids()
    const proc = Bun.spawnSync(["ps", "-eo", "pid=,args="], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const pids: number[] = []
    for (const line of proc.stdout.toString().split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/)
      if (!m) continue
      const pid = parseInt(m[1], 10)
      if (pid === process.pid || ancestors.has(pid)) continue
      const tick = procStartTick(pid)
      if (tick !== null && selfTick !== null && tick >= selfTick) continue
      if (LEFTOVER_RE.test(m[2])) pids.push(pid)
    }
    return pids
  } catch {
    return []
  }
}

async function confirmRecycle(pids: number[]): Promise<boolean> {
  console.log("[dev] leftover dev process(es) detected:")
  for (const pid of pids) {
    const proc = Bun.spawnSync(
      ["ps", "-p", String(pid), "-o", "pid=,lstart=,args="],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )
    console.log(`  ${proc.stdout.toString().trim() || `pid ${pid}`}`)
  }
  if (!input.isTTY) {
    console.error("[dev] not a TTY — aborting to avoid running two dev servers.")
    return false
  }
  const rl = readline.createInterface({ input, output })
  const answer = (
    await rl.question(`[dev] recycle ${pids.length} leftover dev process(es)? [Y/n] `)
  )
    .trim()
    .toLowerCase()
  rl.close()
  return answer === "" || answer === "y" || answer === "yes"
}

function recycle(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
  const deadline = Date.now() + 3000
  while (pids.some(isAlive) && Date.now() < deadline) {
    Bun.sleepSync(100)
  }
  for (const pid of pids) {
    if (!isAlive(pid)) continue
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

const leftovers = findLeftovers()
if (leftovers.length > 0) {
  if (!(await confirmRecycle(leftovers))) {
    console.error("[dev] aborted.")
    process.exit(1)
  }
  recycle(leftovers)
  console.log(`[dev] recycled ${leftovers.length} leftover dev process(es).`)
}

// Persistent Farm watch-build. Farm's FileWatcher (chokidar/inotify)
// incrementally rebuilds on .ts/.tsx/.css module changes, regenerating the
// affected chunks and sw.js so the service worker swaps controllers in place.
const build = Bun.spawn(["bun", join(__dir, "build.ts"), "--watch"], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, NODE_ENV: "development" },
})

const serve = Bun.spawn(["bun", join(__dir, "serve.ts")], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, EDITOR_SELF_BASE: "", NODE_ENV: "development" },
})

// .eta templates are NOT Farm modules — build.ts compiles them to
// src/eta/*.ts via compileAll(). Bridge the gap: recompile on .eta change so
// Farm's watcher sees the regenerated module and rebuilds the bundle + sw.js.
let etaTimer: ReturnType<typeof setTimeout> | null = null
watch(TEMPLATES_DIR, { recursive: true }, (_event, filename) => {
  if (!filename || !filename.endsWith(".eta")) return
  if (etaTimer) clearTimeout(etaTimer)
  etaTimer = setTimeout(() => {
    etaTimer = null
    console.log(`[dev] ${filename} changed — recompiling templates`)
    compileAll(TEMPLATES_DIR, ETA_OUT)
  }, 200)
})

// ── Cleanup ───────────────────────────────────────────────────────────

const cleanup = () => { build.kill(); serve.kill(); process.exit(0) }
process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

await Bun.sleep(Infinity)
