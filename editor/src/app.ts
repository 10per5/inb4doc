import "@milkdown/theme-nord/style.css"
import "katex/dist/katex.min.css"

/* KaTeX math inline style */
import "./styles/math.css"

/* Base styles and CSS variables */
import "./styles/base.css"

/* Layout structure */
import "./styles/layout.css"

/* Component styles */
import "./styles/toolbar.css"
import "./styles/editor.css"
import "./styles/panels.css"
import "./styles/search.css"
import "./styles/milkdown.css"
import "./styles/dialogs.css"

/* Responsive adjustments (applied last for higher specificity) */
import "./styles/responsive.css"

import { Application } from "@hotwired/stimulus"
import EditorController, { setSessionStarted } from "./controllers/editor_controller"
import { setProvider } from "./content/provider-registry"
import { initToast } from "./components/toast/toast"
import { createProvider } from "./content"

async function init() {
  setSessionStarted(Date.now())

  const provider = await createProvider()
  setProvider(provider)

  const app = Application.start()
  app.register("editor", EditorController)

  document.addEventListener("turbo:load", () => {
    app.load()
    initToast()
  })
  initToast()
}

init()
