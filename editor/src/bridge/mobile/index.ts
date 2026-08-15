/**
 * Android WebView (GuiMobile) bridge wiring.
 *
 * The Android app exposes its native functions via `addJavascriptInterface`
 * (window.NativeBridge.*) — see editor/android/.../WebViewActivity.kt. The
 * shared native-consumer code (updater.ts storage/reload, code-block-ui copy,
 * mount-provider) reads `window.saucer.exposed.*` (the desktop Saucer shape),
 * so this shim mirrors the Android methods onto that namespace. It shares the
 * inb4docUI surface + console piping with the desktop bridge (bridge/interface)
 * and stays a no-op on every other host. Host-specific; the pure shared libs
 * live in bridge/index.ts.
 */
import { exposeHostApi, pipeConsole, NATIVE_BRIDGE_METHODS } from "../interface"

// The updater storage bridge (Part C.1 W3) mirrors the desktop envelope:
// every method returns a JSON string {ok, status?, error?, data?}.
function forward(
  exposed: Record<string, unknown>,
  native: Record<string, unknown>,
  from: string,
  to = from
): void {
  if (typeof native[from] === "function" && typeof exposed[to] !== "function") {
    // Must invoke the method ON the injected object. WebView rejects a detached
    // or bound reference with "Java bridge method can't be invoked on a
    // non-injected object"; the arrow re-looks up native[from] per call so the
    // injected object is always the receiver.
    exposed[to] = (...args: unknown[]) =>
      (native as Record<string, (...a: unknown[]) => unknown>)[from](...args)
  }
}

export function initMobileBridge(): void {
  const native = (window as any).NativeBridge as Record<string, unknown> | undefined
  if (!native) return

  exposeHostApi()

  const w = window as any
  w.saucer ??= {}
  const exposed: Record<string, unknown> = w.saucer.exposed ?? {}
  for (const name of NATIVE_BRIDGE_METHODS) {
    forward(exposed, native, name)
  }
  // code-block-ui calls saucer.exposed._nativeCopy(text); the Android bridge
  // spells it copyToClipboard.
  forward(exposed, native, "copyToClipboard", "_nativeCopy")
  w.saucer.exposed = exposed

  // Pipe console output to the native log (available immediately on Android,
  // mirrored onto saucer.exposed.log by the forward loop above).
  pipeConsole()
}
