/**
 * EditorContextService — lazy-loads Milkdown/ProseMirror context keys.
 *
 * All Milkdown/ProseMirror deps are heavy (~515KB shared). This service
 * defers loading until the first call to `load()`, which happens inside
 * `EditorController.ensureEditor()`. After that, the context keys are
 * available synchronously for use inside `editor.action()` callbacks.
 *
 * ## Usage patterns
 *
 * **For `ctx.get()` calls** (needs the service instance):
 * ```ts
 * import { editorContext } from "@/services/editor-context"
 * editor.action((ctx) => {
 *   const view = ctx.get(editorContext.editorViewCtx)
 * })
 * ```
 *
 * **For type-only imports** (zero bundle cost, for annotations):
 * ```ts
 * import type { EditorViewLike, EditorLike } from "@/services/editor-context"
 * ```
 *
 * **For simple view access** (convenience wrappers):
 * ```ts
 * import { getView, getMarkdown, focusView } from "@/services/editor-context"
 * const md = getMarkdown(editor)
 * focusView(editor)
 * ```
 */

import type { Editor } from "@milkdown/kit/core"
import type { EditorView } from "@milkdown/kit/prose/view"

type KitModule = typeof import("@milkdown/kit/core")
type CoreModule = typeof import("@milkdown/core")
type ProseStateModule = typeof import("@milkdown/kit/prose/state")

class EditorContextService {
  private _kit: KitModule | null = null
  private _core: CoreModule | null = null
  private _state: ProseStateModule | null = null
  private _loadPromise: Promise<void> | null = null

  /** Load the shared Milkdown/ProseMirror modules. Safe to call multiple times. */
  load(): Promise<void> {
    if (this._kit && this._core && this._state) return Promise.resolve()
    if (this._loadPromise) return this._loadPromise

    this._loadPromise = Promise.all([
      import("@milkdown/kit/core"),
      import("@milkdown/core"),
      import("@milkdown/kit/prose/state"),
    ]).then(([kit, core, state]) => {
      this._kit = kit
      this._core = core
      this._state = state
    })

    return this._loadPromise
  }

  get loaded(): boolean {
    return this._kit !== null && this._core !== null && this._state !== null
  }

  // ── Context keys (safe to access after load()) ──

  get editorViewCtx() {
    return this._kit!.editorViewCtx
  }

  get commandsCtx() {
    return this._kit!.commandsCtx
  }

  get serializerCtx() {
    return this._kit!.serializerCtx
  }

  get parserCtx() {
    return this._core!.parserCtx
  }

  // ── ProseMirror state constructors ──

  get EditorState() {
    return this._state!.EditorState
  }

  get TextSelection() {
    return this._state!.TextSelection
  }

  get NodeSelection() {
    return this._state!.NodeSelection
  }

  get Plugin() {
    return this._state!.Plugin
  }

  get PluginKey() {
    return this._state!.PluginKey
  }
}

export const editorContext = new EditorContextService()

// ── Convenience wrappers ──
// These avoid repetitive `editor.action(ctx => ctx.get(...))` patterns.

/** Get the ProseMirror EditorView from a Milkdown Editor. */
export function getView(editor: Editor): EditorView {
  return editor.action((ctx) => ctx.get(editorContext.editorViewCtx))
}

/** Get the current editor content as Markdown. */
export function getMarkdown(editor: Editor): string {
  return editor.action((ctx) => {
    const serializer = ctx.get(editorContext.serializerCtx)
    return serializer(ctx.get(editorContext.editorViewCtx).state.doc)
  })
}

/** Focus the ProseMirror editor. */
export function focusView(editor: Editor): void {
  editor.action((ctx) => {
    ctx.get(editorContext.editorViewCtx).focus()
  })
}
