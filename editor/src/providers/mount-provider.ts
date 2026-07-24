import { RemoteProvider } from "@/providers/remote-provider"
import { ProviderType } from "@/providers/index"
import { hasFunc, AppFunc } from "$/build/build-mode"

/**
 * MountProvider — serves content via the embedded `app://` scheme handler
 * (gui/src/scheme.cpp). Used in GuiDesktop builds where the editor is loaded
 * from `app://` and the C++ backend handles file I/O.
 *
 * Extends RemoteProvider with:
 *   - Relative paths (the app:// scheme routes requests to C++)
 *   - No HTTP probe (availability determined by AppFunc flag)
 */
export class MountProvider extends RemoteProvider {
  readonly name = ProviderType.Mount

  protected url(path: string): string {
    return path
  }

  async isAvailable(): Promise<boolean> {
    return hasFunc(AppFunc.MountProvider)
  }
}
