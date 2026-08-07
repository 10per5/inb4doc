import type { ContentProvider, ImageEntry, SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { callBridge, setContentRoot } from "@/bridge/native"
import { backendError } from "@/utils/backend-error"
import { sanitizeImageName } from "@/utils/sanitize"

/**
 * SafProvider — Android Storage Access Framework provider (GuiMobile).
 *
 * All I/O goes through the native bridge (`window.saucer.exposed.*`, backed
 * by the Kotlin `NativeBridge` in WebViewActivity.kt). Unlike the desktop
 * MountProvider it does NOT use a URL scheme: the mobile document origin is
 * `file://`, so nothing is served over `app://<root>/` — the bridge returns
 * raw content (and `content://` URIs for images).
 */
export class SafProvider implements ContentProvider {
  readonly name = ProviderType.Saf
  private imageUrlCache = new Map<string, string>()

  async isAvailable(): Promise<boolean> {
    return hasFunc(AppFunc.SafProvider)
  }

  async getTree(): Promise<TreeIndex> {
    const env = await callBridge("getTree")
    const data = env.data as
      | { paths?: string[]; folderWeights?: Record<string, number>; fileWeights?: Record<string, number> }
      | undefined
    return buildTreeIndex({
      paths: data?.paths ?? [],
      children: {},
      folderWeights: data?.folderWeights ?? {},
      fileWeights: data?.fileWeights,
    })
  }

  async readFile(path: string): Promise<string | null> {
    const env = await callBridge("readFile", `${path}.md`)
    const content = env.data as string | null
    return content
  }

  async writeFile(path: string, content: string): Promise<void> {
    await callBridge("writeFile", `${path}.md`, content)
  }

  async deleteFile(path: string): Promise<void> {
    await this.deleteFiles([path])
  }

  async deleteFiles(paths: string[]): Promise<void> {
    await callBridge("deleteFiles", paths.map((p) => `${p}.md`))
  }

  async moveFile(from: string, to: string): Promise<void> {
    await callBridge("moveFile", `${from}.md`, `${to}.md`)
  }

  async getServerTime(path: string): Promise<number | null> {
    const env = await callBridge("getServerTime", `${path}.md`)
    return (env.data as number | null) ?? null
  }

  async search(query: string): Promise<SearchResult[]> {
    const env = await callBridge("search", query)
    const data = env.data as { results?: SearchResult[] } | undefined
    return data?.results ?? []
  }

  async uploadImage(file: File, dir: string): Promise<string> {
    const name = sanitizeImageName(file.name)
    const b64 = await fileToBase64(file)
    const env = await callBridge("uploadImage", name, dir, b64)
    const url = (env.data as { url?: string } | undefined)?.url
    if (!url) throw backendError(500, "Upload returned no URL")
    this.cacheImage(dir, name)
    return url
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
    const env = await callBridge("listImages", dir, refs ?? false)
    const data = env.data as { images?: ImageEntry[] } | undefined
    const images = data?.images ?? []
    for (const img of images) {
      this.cacheImage(dir, img.name, img.url)
    }
    return images
  }

  async deleteImage(name: string, dir: string): Promise<void> {
    await callBridge("deleteImage", name, dir)
  }

  private cacheImage(dir: string, name: string, uri?: string): void {
    if (!uri) return
    const key = `${dir ? dir + "/" : ""}image/${name}`
    this.imageUrlCache.set(key, uri)
    this.imageUrlCache.set(`image/${name}`, uri)
  }

  resolveImageUrl(url: string): string | undefined {
    const normalized = url.startsWith("/") ? url.slice(1) : url
    return this.imageUrlCache.get(normalized)
  }

  /** Runtime directory reselection: point the native SAF root at a new tree URI. */
  async setRoot(path: string): Promise<void> {
    this.imageUrlCache.clear()
    await setContentRoot(path)
  }

  /** Async form of resolveImageUrl for the mobile bridge (content:// URIs). */
  async resolveImageToUri(url: string): Promise<string | null> {
    const normalized = url.startsWith("/") ? url.slice(1) : url
    const env = await callBridge("resolveImage", normalized)
    const uri = env.data as string | null
    return uri ? uri : null
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
