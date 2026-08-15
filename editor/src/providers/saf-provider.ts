import type { ImageEntry } from "@/providers/provider"
import type { SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { callBridge, setContentRoot } from "@/bridge/native"
import { BridgeOp } from "@/config/enums/bridge-op"
import { backendError } from "@/utils/backend-error"
import { MountProvider, fileToBase64 } from "@/providers/mount-provider"

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
 *
 * All bridge FS ops take RELATIVE PATHS only — the Kotlin side decides the
 * root from the active provider (setNativeProvider): Saf ("On This Device")
 * roots at the built-in docs tree, the Local Files delegate roots at its picked
 * tree. JS never knows where a provider is hooked. `rootTreeUri` remains only
 * for building deterministic content:// image URLs on the built-in docs tree.
 */
export class SafProvider extends MountProvider {
  readonly name = ProviderType.Saf

  private imageUrlCache = new Map<string, string>()
  private rootTreeUri = DOCS_TREE_URI

  async isAvailable(): Promise<boolean> {
    return hasFunc(AppFunc.SafProvider)
  }

  async getTree(): Promise<TreeIndex> {
    const env = await callBridge(BridgeOp.GetTree)
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
    const env = await callBridge(BridgeOp.ReadFile, `${path}.md`)
    return env.data as string | null
  }

  async writeFile(path: string, content: string): Promise<void> {
    await callBridge(BridgeOp.WriteFile, `${path}.md`, content)
  }

  async deleteFiles(paths: string[]): Promise<void> {
    await callBridge(BridgeOp.DeleteFiles, paths.map((p) => `${p}.md`))
  }

  async moveFile(from: string, to: string): Promise<void> {
    await callBridge(BridgeOp.MoveFile, `${from}.md`, `${to}.md`)
  }

  async deleteFile(path: string): Promise<void> {
    await this.deleteFiles([path])
  }

  async getServerTime(path: string): Promise<number | null> {
    const env = await callBridge(BridgeOp.GetServerTime, `${path}.md`)
    return (env.data as number | null) ?? null
  }

  async search(query: string): Promise<SearchResult[]> {
    const env = await callBridge(BridgeOp.Search, query)
    const data = env.data as { results?: SearchResult[] } | undefined
    return data?.results ?? []
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
    const env = await callBridge(BridgeOp.ListImages, dir, refs ?? false)
    const data = env.data as { images?: ImageEntry[] } | undefined
    const images = data?.images ?? []
    for (const img of images) {
      this.cacheImage(dir, img.name, img.url)
    }
    return images
  }

  async uploadImage(file: File, dir: string): Promise<string> {
    const b64 = await fileToBase64(file)
    const env = await callBridge(BridgeOp.UploadImage, file.name, dir, b64)
    const url = (env.data as { url?: string } | undefined)?.url
    if (!url) throw backendError(500, "Upload returned no URL")
    return url
  }

  async renameImage(name: string, dir: string, newName: string): Promise<string> {
    const env = await callBridge(BridgeOp.RenameImage, name, dir, newName)
    const url = (env.data as { url?: string } | undefined)?.url
    if (!url) throw backendError(500, "Rename returned no URL")
    return url
  }

  async deleteImage(name: string, dir: string): Promise<void> {
    await callBridge(BridgeOp.DeleteImage, name, dir)
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
