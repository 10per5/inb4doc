/**
 * CommandService — lazy-loads CommonMark/GFM command presets.
 *
 * These are only needed when toolbar buttons are clicked. Lazy-loading
 * avoids pulling ~50KB of preset code into the main bundle.
 *
 * Context keys (`commandsCtx`, `editorViewCtx`) come from
 * `editorContext` — this service only provides the command objects.
 *
 * Command objects are `$Command<T>` (functions with `.key` and `.meta`).
 * `.key` is populated after the editor installs the plugin via `.use()`.
 * Access `.key` only inside `editor.action()` callbacks.
 */

import type { $Command } from "@milkdown/utils"

type CommonmarkModule = typeof import("@milkdown/kit/preset/commonmark")
type GfmModule = typeof import("@milkdown/kit/preset/gfm")

class CommandService {
  private _cm: CommonmarkModule | null = null
  private _gfm: GfmModule | null = null
  private _loadPromise: Promise<void> | null = null

  load(): Promise<void> {
    if (this._cm && this._gfm) return Promise.resolve()
    if (this._loadPromise) return this._loadPromise

    this._loadPromise = Promise.all([
      import("@milkdown/kit/preset/commonmark"),
      import("@milkdown/kit/preset/gfm"),
    ]).then(([cm, gfm]) => {
      this._cm = cm
      this._gfm = gfm
    })

    return this._loadPromise
  }

  get loaded(): boolean {
    return this._cm !== null && this._gfm !== null
  }

  get toggleStrongCommand(): $Command<unknown> {
    return this._cm!.toggleStrongCommand
  }

  get toggleEmphasisCommand(): $Command<unknown> {
    return this._cm!.toggleEmphasisCommand
  }

  get toggleInlineCodeCommand(): $Command<unknown> {
    return this._cm!.toggleInlineCodeCommand
  }

  get wrapInHeadingCommand(): $Command<number> {
    return this._cm!.wrapInHeadingCommand
  }

  get insertHrCommand(): $Command<unknown> {
    return this._cm!.insertHrCommand
  }

  get sinkListItemCommand(): $Command<unknown> {
    return this._cm!.sinkListItemCommand
  }

  get liftListItemCommand(): $Command<unknown> {
    return this._cm!.liftListItemCommand
  }

  get wrapInBulletListCommand(): $Command<unknown> {
    return this._cm!.wrapInBulletListCommand
  }

  get wrapInOrderedListCommand(): $Command<unknown> {
    return this._cm!.wrapInOrderedListCommand
  }

  get toggleStrikethroughCommand(): $Command<unknown> {
    return this._gfm!.toggleStrikethroughCommand
  }
}

export const commandService = new CommandService()
