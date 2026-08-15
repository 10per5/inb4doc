import type { ImageEntry } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { callBridge, setContentRoot } from "@/bridge/native"
import { MountProvider } from "@/providers/mount-provider"

const DOCS_TREE_URI = "content://inb4doc.editor.docs/tree/docs"

/**
 * SafProvider — Android SAF provider (GuiMobile).
 *
 * Extends MountProvider: the write-side ops (writeFile / deleteFiles / moveFile
 * / search / uploadImage / renameImage / setRoot) already go through the native
 * bridge (window.saucer.exposed.* → Kotlin NativeBridge). Only the read-side
 * ops that MountProvider/RemoteProvider would otherwise serve over the `app://`
 * / HTTP scheme are overridden here to hit the bridge, because the mobile
 * document origin is `file://` and the content lives behind DocumentsContract
 * (SafFs + DocsProvider).
 */
export class SafProvider extends MountProvider {
  readonly name = ProviderType.Saf

  private imageUrlCache = new Map<string, string>()
  private rootTreeUri = DOCS_TREE_URI

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
    return env.data as string | null
  }

  async deleteFile(path: string): Promise<void> {
    await this.deleteFiles([path])
  }

  async getServerTime(path: string): Promise<number | null> {
    const env = await callBridge("getServerTime", `${path}.md`)
    return (env.data as number | null) ?? null
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
    const cached = this.imageUrlCache.get(normalized)
    if (cached) return cached
    // Built-in docs tree: document id == rel path, so the content:// URI is
    // deterministic without a prior listImages. User-picked trees must go
    // through the cache (their authority/doc ids are not constructible in JS).
    if (this.rootTreeUri.startsWith("content://inb4doc.editor.docs/")) {
      return `content://inb4doc.editor.docs/tree/docs/document/${normalized}`
    }
    return undefined
  }

  /** Runtime directory reselection: point the native SAF root at a new tree URI. */
  async setRoot(path: string): Promise<void> {
    this.imageUrlCache.clear()
    this.rootTreeUri = path
    await setContentRoot(path)
  }
}
