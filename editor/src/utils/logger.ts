import { isDev, debugLogging } from "@/config"

export type LogLevel = "debug" | "info" | "warn" | "error"

// Build-time verbosity gate (dev builds or DEBUG_LOGGING=1). Non-error levels
// are silent in shipped builds; errors always surface so real failures are seen
// (e.g. a failed updater apply on a first-run thin shell).
const VERBOSE = isDev || debugLogging

type Scope = string | object | undefined

// Derive the log-line tag from the scope: a class instance yields its prototype
// name (pass `this` in a class method), a string is used verbatim, and a
// scope-less call falls back to "app".
function tag(scope: Scope): string {
  if (typeof scope === "string") return scope
  if (scope && typeof scope === "object") {
    const name = scope.constructor?.name
    if (name && name !== "Object") return name
  }
  return "app"
}

function emit(level: LogLevel, scope: Scope, args: unknown[]): void {
  if (level !== "error" && !VERBOSE) return
  console[level](`[${tag(scope)}]`, ...args)
}

// Singleton logger. Methods take an optional scope first — pass `this` inside a
// class method to tag the line with the class name, or a string namespace for
// module-level call sites. Errors always print; debug/info/warn only in verbose
// builds.
export const logger = {
  debug(scope: Scope, ...args: unknown[]): void {
    emit("debug", scope, args)
  },
  info(scope: Scope, ...args: unknown[]): void {
    emit("info", scope, args)
  },
  warn(scope: Scope, ...args: unknown[]): void {
    emit("warn", scope, args)
  },
  error(scope: Scope, ...args: unknown[]): void {
    emit("error", scope, args)
  },
}
