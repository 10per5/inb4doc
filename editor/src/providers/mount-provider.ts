import { RemoteProvider } from "@/providers/remote-provider"
import { ProviderType } from "@/providers/index"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { backendError } from "@/utils/backend-error"
import { callBridge, setContentRoot } from "@/bridge/native"
import type { SearchResult } from "@/providers/provider"

/**
 * MountProvider — serves content via the embedded `app://` scheme handler
 * (gui/src/scheme.cpp). Used in GuiDesktop builds where the editor is loaded
 * from `app://` and the C++ backend handles file I/O.
 *
 * Extends RemoteProvider with:
 *   - Relative paths (the app:// scheme routes requests to C++)
 *   - No HTTP probe (availability determined by AppFunc flag)
 *
 * Operations that carry a request body (PUT/POST) are routed through the
 * native bridge (window.saucer.exposed.*, gui/src/bridge.cpp) because Qt
 * WebEngine's custom-scheme body transport hangs. GET/HEAD/DELETE have no
 * body and keep using the scheme via the inherited RemoteProvider fetch.
 */
export class MountProvider extends RemoteProvider {
  readonly name = ProviderType.Mount

  protected url(path: string): string {
    return path
  }

  async isAvailable(): Promise<boolean> {
    return hasFunc(AppFunc.MountProvider)
  }

  async writeFile(path: string, content: string): Promise<void> {
    await callBridge("writeFile", `${path}.md`, content)
  }

  async deleteFiles(paths: string[]): Promise<void> {
    await callBridge("deleteFiles", paths.map((p) => `${p}.md`))
  }

  async moveFile(from: string, to: string): Promise<void> {
    await callBridge("moveFile", `${from}.md`, `${to}.md`)
  }

  async search(query: string): Promise<SearchResult[]> {
    const env = await callBridge("search", query)
    const data = env.data as { results?: SearchResult[] } | undefined
    return data?.results ?? []
  }

  async uploadImage(file: File, dir: string): Promise<string> {
    const b64 = await fileToBase64(file)
    const env = await callBridge("uploadImage", file.name, dir, b64)
    const url = (env.data as { url?: string } | undefined)?.url
    if (!url) throw backendError(500, "Upload returned no URL")
    return url
  }

  async renameImage(name: string, dir: string, newName: string): Promise<string> {
    const env = await callBridge("renameImage", name, dir, newName)
    const url = (env.data as { url?: string } | undefined)?.url
    if (!url) throw backendError(500, "Rename returned no URL")
    return url
  }

  /** Point the native host at a new content root (runtime directory reselection). */
  async setRoot(path: string): Promise<void> {
    await setContentRoot(path)
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read file"))
        return
      }
      const comma = reader.result.indexOf(",")
      resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result)
    }
    reader.readAsDataURL(file)
  })
}
