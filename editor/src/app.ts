import "./styles/index"

import { Application } from "@hotwired/stimulus"
import ShellController from "@/controllers/shell_controller"
import TopbarController from "@/controllers/topbar-controller"
import SidebarController from "@/controllers/sidebar-controller"
import EditorController from "@/controllers/editor-controller"
import { setSessionStarted } from "@/controllers/shell_controller"
import { initializeProvider } from "@/stores/provider-store"
import { initToast } from "@/components/notification/toast"
import { initNotifications } from "@/components/notification/notification"
import { initBridge } from "@/bridge/index"

import { ConfirmDialogController } from "@/controllers/dialog/confirm-dialog-controller"
import { PromptDialogController } from "@/controllers/dialog/prompt-dialog-controller"
import { CreateDialogController } from "@/controllers/dialog/create-dialog-controller"
import { LinkDialogController } from "@/controllers/dialog/link-dialog-controller"
import { VideoDialogController } from "@/controllers/dialog/video-dialog-controller"
import { HugoRefDialogController } from "@/controllers/dialog/hugoref-dialog-controller"
import { PrefsDialogController } from "@/controllers/dialog/prefs-dialog-controller"
import { ImportZipDialogController } from "@/controllers/dialog/import-zip-dialog-controller"
import { ImageManagerDialogController } from "@/controllers/dialog/image-manager-dialog-controller"
import { ChangesDialogController } from "@/controllers/dialog/changes-dialog-controller"
import { ExternalChangeDialogController } from "@/controllers/dialog/external-change-dialog-controller"
import { ProviderDialogController } from "@/controllers/dialog/provider-dialog-controller"
import { PressTwiceController } from "@/controllers/press-twice-controller"
import ContextMenuController from "@/controllers/context-menu-controller"

async function init() {
  setSessionStarted(Date.now())

  await initializeProvider()

  const app = new Application()
  app.register("shell", ShellController)
  app.register("topbar", TopbarController)
  app.register("sidebar", SidebarController)
  app.register("editor", EditorController)

  app.register("confirm-dialog", ConfirmDialogController)
  app.register("prompt-dialog", PromptDialogController)
  app.register("create-dialog", CreateDialogController)
  app.register("link-dialog", LinkDialogController)
  app.register("video-dialog", VideoDialogController)
  app.register("hugoref-dialog", HugoRefDialogController)
  app.register("prefs-dialog", PrefsDialogController)
  app.register("import-zip-dialog", ImportZipDialogController)
  app.register("image-manager-dialog", ImageManagerDialogController)
  app.register("changes-dialog", ChangesDialogController)
  app.register("external-change-dialog", ExternalChangeDialogController)
  app.register("provider-dialog", ProviderDialogController)
  app.register("press-twice", PressTwiceController)
  app.register("context-menu", ContextMenuController)

  await app.start()
  initToast()
  initNotifications()
  initBridge()
}

init()
