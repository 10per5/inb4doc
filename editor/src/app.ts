import "@milkdown/theme-nord/style.css"

/* ── Foundation ────────────────────────────────────────────────── */
import "./styles/foundation/base.css"

/* ── Layout ─────────────────────────────────────────────────────── */
import "./styles/layout/layout.css"
import "./styles/layout/responsive.css"

/* ── Editor ─────────────────────────────────────────────────────── */
import "./styles/editor/editor.css"
import "./styles/editor/math.css"
import "./styles/editor/milkdown.css"

/* ── Panels ─────────────────────────────────────────────────────── */
import "./styles/panels/panels.css"
import "./styles/panels/search.css"

/* ── App UI ─────────────────────────────────────────────────────── */
import "./styles/app/toolbar.css"
import "./styles/app/dialogs.css"

import { Application } from "@hotwired/stimulus"
import ShellController from "@/controllers/shell_controller"
import { setSessionStarted } from "@/orchestrator"
import { setProvider } from "@/providers/provider-registry"
import { initToast } from "@/components/notification/toast"
import { initNotifications } from "@/components/notification/notification"
import { initBridge } from "@/bridge/index"
import { createProvider } from "@/providers"

async function init() {
  setSessionStarted(Date.now())

  const provider = await createProvider()
  setProvider(provider)

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
