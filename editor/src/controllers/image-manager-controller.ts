import * as icons from "@/eta/icons"
import { BaseDialogController } from "./dialog/base-dialog-controller"
import type { ImageEntry } from "@/providers/provider"
import { appEvents, AppEvent } from "@/stores/app-events"
import { openDialog } from "@/services/dialog-service"
import { renderScreen } from "@/eta/views/screen"
import { loadImageManagerData, bindImageManagerActions } from "@/components/ui/image-manager"
import renderImageManagerRows from "@/eta/views/image-manager-rows"
import renderImageManagerScreen from "@/eta/views/controller/image-manager-screen"
import renderImageManagerDialog from "@/eta/views/dialog/image-manager-dialog"

// One controller per feature: registered as `image-manager`, it renders the
// desktop dialog when the element carries a payload (dialog-service mounts
// data-image-manager-payload-value) and the mobile fullview screen otherwise.
// The screen defers its data load to load() (called by the view controller on
// activation, once the provider is ready) — mirroring disk-usage.
export default class ImageManagerController extends BaseDialogController {
  static values = { payload: Object }

  declare payloadValue: {
    title: string
    dir?: string
    loadError?: string | null
    allEntries: (ImageEntry & { pending?: boolean })[]
    rows: string
  }

  // Stimulus generates this runtime getter from `static values`; the shipped
  // types don't (dialogs always carried a payload before the merge).
  declare readonly hasPayloadValue: boolean

  connect(): void {
    if (!this.hasPayloadValue) return
    this.element.innerHTML = renderImageManagerDialog(this.payloadValue)
    bindImageManagerActions(this.element as HTMLElement, {
      onAllImagesDeleted: () => this.close(),
    })
  }

  close(): void {
    if (this.hasPayloadValue) {
      this.cancel()
      return
    }
    appEvents.emit(AppEvent.ViewChanged, { view: "more" })
  }

  /** Called by the view controller when the screen is activated (provider ready). */
  async load(): Promise<void> {
    const data = await loadImageManagerData()
    this.element.innerHTML = renderImageManagerScreen({
      icons: icons as Record<string, string>,
      renderScreen,
      rows: renderImageManagerRows(data as unknown as Record<string, unknown>),
    })
    bindImageManagerActions(this.element as HTMLElement, {
      onAllImagesDeleted: () => this.close(),
    })
  }
}

/** Dialog facade — used by shell_controller's desktop path. */
export async function openImageManagerDialog(): Promise<void> {
  const data = await loadImageManagerData()

  openDialog("image-manager", {
    title: "Image Manager",
    dir: data.dir,
    loadError: data.loadError,
    allEntries: data.allEntries,
    rows: renderImageManagerRows(data as unknown as Record<string, unknown>),
  })
}
