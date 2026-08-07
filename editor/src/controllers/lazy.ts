import { Application } from "@hotwired/stimulus"

import EditorController from "./editor-controller"

import { ConfirmDialogController } from "./dialog/confirm-dialog-controller"
import { PromptDialogController } from "./dialog/prompt-dialog-controller"
import { CreateDialogController } from "./dialog/create-dialog-controller"
import { LinkDialogController } from "./dialog/link-dialog-controller"
import { VideoDialogController } from "./dialog/video-dialog-controller"
import { HugoRefDialogController } from "./dialog/hugoref-dialog-controller"
import { PrefsDialogController } from "./dialog/prefs-dialog-controller"
import { ImportZipDialogController } from "./dialog/import-zip-dialog-controller"
import { ImageManagerDialogController } from "./dialog/image-manager-dialog-controller"
import { ChangesDialogController } from "./dialog/changes-dialog-controller"
import { ExternalChangeDialogController } from "./dialog/external-change-dialog-controller"
import { ProviderDialogController } from "./dialog/provider-dialog-controller"

import type { ControllerRegistration } from "./core"

// Part D two-stage entry: these controllers live behind a dynamic import
// (registered after app.start()). The editor is only reachable through it, so
// editor-config + all @milkdown/* (node_imports) leave the eager boot set and
// the thin shell can download them on first run instead of shipping them.
// Registering after start is safe: Stimulus's scope observer already recorded
// the data-controller scopes for the initial DOM, so connect() fires the
// moment each identifier registers.
const lazyRegistrations: ControllerRegistration[] = [
  { name: "editor", controller: EditorController },
  { name: "confirm-dialog", controller: ConfirmDialogController },
  { name: "prompt-dialog", controller: PromptDialogController },
  { name: "create-dialog", controller: CreateDialogController },
  { name: "link-dialog", controller: LinkDialogController },
  { name: "video-dialog", controller: VideoDialogController },
  { name: "hugoref-dialog", controller: HugoRefDialogController },
  { name: "prefs-dialog", controller: PrefsDialogController },
  { name: "import-zip-dialog", controller: ImportZipDialogController },
  { name: "image-manager-dialog", controller: ImageManagerDialogController },
  { name: "changes-dialog", controller: ChangesDialogController },
  { name: "external-change-dialog", controller: ExternalChangeDialogController },
  { name: "provider-dialog", controller: ProviderDialogController },
]

export function registerLazyControllers(app: Application): void {
  for (const { name, controller } of lazyRegistrations) {
    app.register(name, controller)
  }
}
