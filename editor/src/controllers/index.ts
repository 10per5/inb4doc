import { Application } from "@hotwired/stimulus"

import ShellController from "./shell_controller"
import TopbarController from "./topbar-controller"
import SidebarController from "./sidebar-controller"
import EditorController from "./editor-controller"
import ContextMenuController from "./context-menu-controller"
import PressTwiceController from "./press-twice-controller"
import EmptyProjectController from "./empty-project-controller"

import ConfirmDialogController from "./dialog/confirm-dialog-controller"
import PromptDialogController from "./dialog/prompt-dialog-controller"
import CreateDialogController from "./dialog/create-dialog-controller"
import LinkDialogController from "./dialog/link-dialog-controller"
import VideoDialogController from "./dialog/video-dialog-controller"
import HugoRefDialogController from "./dialog/hugoref-dialog-controller"
import PrefsDialogController from "./dialog/prefs-dialog-controller"
import ImportZipDialogController from "./dialog/import-zip-dialog-controller"
import ImageManagerDialogController from "./dialog/image-manager-dialog-controller"
import ChangesDialogController from "./dialog/changes-dialog-controller"
import ExternalChangeDialogController from "./dialog/external-change-dialog-controller"
import ProviderDialogController from "./dialog/provider-dialog-controller"

export interface ControllerRegistration {
  name: string
  controller: Constructor<Controller>
}

const registrations: ControllerRegistration[] = [
  { name: "shell", controller: ShellController },
  { name: "topbar", controller: TopbarController },
  { name: "sidebar", controller: SidebarController },
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
  { name: "press-twice", controller: PressTwiceController },
  { name: "context-menu", controller: ContextMenuController },
  { name: "empty-project", controller: EmptyProjectController },
]

export function registerControllers(app: Application): void {
  for (const { name, controller } of registrations) {
    app.register(name, controller)
  }
}
