import "./styles/index"

import { Application } from "@hotwired/stimulus"
import { setSessionStarted } from "@/controllers/shell_controller"
import { initializeProvider } from "@/stores/provider-store"
import { initToast } from "@/components/notification/toast"
import { initNotifications } from "@/components/notification/notification"
import { initBridge } from "@/bridge/index"
import { registerControllers } from "@/controllers"

async function init() {
  setSessionStarted(Date.now())

  await initializeProvider()

  const app = new Application()
  registerControllers(app)

  await app.start()
  initToast()
  initNotifications()
  initBridge()
}

init()
