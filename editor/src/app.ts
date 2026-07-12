import "./styles/index"

import { Application } from "@hotwired/stimulus"
import ShellController from "@/controllers/shell_controller"
import { setSessionStarted } from "@/controllers/app-controller"
import { initializeProvider } from "@/stores/provider-store"
import { initToast } from "@/components/notification/toast"
import { initNotifications } from "@/components/notification/notification"
import { initBridge } from "@/bridge/index"

async function init() {
  setSessionStarted(Date.now())

  await initializeProvider()

  const app = Application.start()
  app.register("editor", ShellController)

  document.addEventListener("turbo:load", () => {
    app.load()
    initToast()
    initNotifications()
    initBridge()
  })
  initToast()
  initNotifications()
  initBridge()
}

init()
