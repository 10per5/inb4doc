import type { ContentProvider, ImageEntry, SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { connectionStore } from "@/stores/connection-store"
import { backendError } from "@/utils/backend-error"

/**
 * ServerProvider — connects to a remote HTTP content server.
 *
 * For the embedded GUI `app://` scheme handler, see MountProvider.
 */
export class RemoteProvider implements ContentProvider {
  readonly name: ProviderType = ProviderType.Remote

  protected url(path: string): string {
    return `${connectionStore.getBaseUrl()}${path}`
  }

  async isAvailable(): Promise<boolean> {
    return connectionStore.probe()
  }

  async getTree(): Promise<TreeIndex> {
    const res = await fetch(this.url("/api/tree"))
    if (!res.ok) return buildTreeIndex({ paths: [], children: {}, folderWeights: {} })
    const data = await res.json()
    return buildTreeIndex(data)
  }

  async readFile(path: string): Promise<string | null> {
    const res = await fetch(this.url(`/content/${path}.md`))
    if (!res.ok) return null
    return res.text()
  }

  async writeFile(path: string, content: string): Promise<void> {
    const res = await fetch(this.url(`/content/${path}.md`), {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: content,
    })
    if (!res.ok) {
      throw backendError(res.status, `Write failed: ${res.status} ${res.statusText}`)
    }
  }

  async deleteFile(path: string): Promise<void> {
    const res = await fetch(this.url(`/content/${path}.md`), { method: "DELETE" })
    if (!res.ok) {
      throw backendError(res.status, `Delete failed: ${res.status} ${res.statusText}`)
    }
  }

  async deleteFiles(paths: string[]): Promise<void> {
    const res = await fetch(this.url("/api/delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    })
    if (!res.ok) throw backendError(res.status, `Bulk delete failed: ${res.status}`)
  }

  async moveFile(from: string, to: string): Promise<void> {
    const res = await fetch(this.url("/api/move"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${from}.md`, to: `${to}.md` }),
    })
    if (!res.ok) throw backendError(res.status, `Move failed: ${res.status}`)
  }

  async search(query: string): Promise<SearchResult[]> {
    const res = await fetch(this.url("/api/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  }

  async getServerTime(path: string): Promise<number | null> {
    const res = await fetch(this.url(`/content/${path}.md`), { method: "HEAD" })
    if (!res.ok) return null
    const lastModified = res.headers.get("Last-Modified")
    if (!lastModified) return null
    return new Date(lastModified).getTime()
  }

  async uploadImage(file: File, dir: string): Promise<string> {
    const form = new FormData()
    form.append("file", file)
    form.append("dir", dir)
    const resp = await fetch(this.url("/api/upload"), { method: "POST", body: form })
    if (!resp.ok) throw backendError(resp.status, `Upload failed: ${resp.statusText}`)
    const result = await resp.json()
    return result.url
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
    const params = new URLSearchParams({ dir })
    if (refs) params.set("refs", "true")
    const resp = await fetch(this.url(`/api/images?${params}`))
    if (!resp.ok) throw backendError(resp.status, `Failed to list images: ${resp.statusText}`)
    const data = await resp.json()
    return data.images.map((img: any) => ({
      name: img.name,
      url: img.url,
      storageUrl: img.storageUrl,
      usedIn: img.usedIn || [],
    }))
  }

  resolveImageUrl(url: string): string | undefined {
    return undefined;
  }

  async deleteImage(name: string, dir: string): Promise<void> {
    const resp = await fetch(this.url(`/api/images/${encodeURIComponent(name)}?dir=${encodeURIComponent(dir)}`), {
      method: "DELETE",
    })
    if (!resp.ok) throw backendError(resp.status, `Failed to delete image: ${resp.statusText}`)
  }

  async renameImage(name: string, dir: string, newName: string): Promise<string> {
    const resp = await fetch(this.url("/api/rename-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dir, newName }),
    })
    if (!resp.ok) throw backendError(resp.status, `Failed to rename image: ${resp.statusText}`)
    const data = await resp.json()
    if (!data.url) throw backendError(500, "Rename returned no URL")
    return data.url
  }
}
