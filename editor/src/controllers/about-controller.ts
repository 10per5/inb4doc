import * as icons from "@/eta/icons"
import { BaseDialogController } from "./dialog/base-dialog-controller"
import { appVersion } from "@/config"
import { computeLiveUrl } from "@/controllers/sidebar/sidebar"
import { getProvider } from "@/stores/provider-store"
import { getCurrentPath } from "@/utils/url"
import { buildAboutLinks } from "@/components/ui/prefs-panes"
import { appEvents, AppEvent } from "@/stores/app-events"
import { openDialog } from "@/services/dialog-service"
import { renderScreen } from "@/eta/views/screen"
import renderAboutDialog from "@/eta/views/dialog/about-dialog"
import renderAboutScreen from "@/eta/views/controller/about-screen"

/**
 * About inb4doc — a mini window (desktop dialog / mobile fullview screen) with
 * links to the published documentation and the repository. Same one-controller
 * shape as PrefsController: the presence of a payload decides whether it
 * renders the dialog or the screen.
 */
const DEFAULT_DOCS_URL = "https://10per5.github.io/inb4doc/"

export default class AboutController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {}

  declare readonly hasPayloadValue: boolean

  connect(): void {
    if (this.hasPayloadValue) {
      this.element.innerHTML = renderAboutDialog({
        icons: icons as Record<string, string>,
        links: buildAboutLinks(this.liveUrl()),
        version: appVersion,
      })
      return
    }
    if (this.element.querySelector(".screen")) return
    this.element.innerHTML = renderAboutScreen({
      icons: icons as Record<string, string>,
      renderScreen,
      links: buildAboutLinks(this.liveUrl()),
      version: appVersion,
    })
  }

  close(): void {
    if (this.hasPayloadValue) {
      this.cancel()
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  // The published wiki (what the sidebar used to call "View live version").
  // `computeLiveUrl` resolves the deployed static build for the active
  // provider; without a configured deployment it falls back to the Pages site.
  private liveUrl(): string {
    return (
      computeLiveUrl(getProvider().name, getCurrentPath()) || DEFAULT_DOCS_URL
    )
  }
}

/** Dialog facade — used by shell_controller's desktop path. */
export function openAboutDialog(): void {
  openDialog("about", {})
}
