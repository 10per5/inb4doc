import type { ContentProvider, TreeNode, ImageEntry, SearchResult } from "@/providers/provider"
import { ProviderType } from "@/providers/index"
import { connectionStore } from "@/stores/connection-store"

export class RemoteProvider implements ContentProvider {
  readonly name = ProviderType.Remote

  /**
   * True when the embedded `app://` content API should be used instead of a
   * real HTTP server. This happens when the editor is loaded from the `app://`
   * scheme (embedded GUI), or when the user explicitly configured an `app://`
   * host (`app://_/`, `app://`, `app://_`).
   */
  get appFallback(): boolean {
    if (typeof window !== "undefined" && window.location.protocol === "app:") {
      return !connectionStore.remoteAvailable
    }
    const host = connectionStore.getHost()
    return (
      host === "app://" ||
      host === "app://_" ||
      host.startsWith("app://_/")
    )
  }

  private url(path: string): string {
    if (this.appFallback) {
      return path
    }
    return `${connectionStore.getBaseUrl()}${path}`
  }

  async isAvailable(): Promise<boolean> {
    if (await connectionStore.probe()) {
      return true
    }
    return this.appFallback
  }

  async getTree(): Promise<TreeNode> {
    const res = await fetch(this.url("/api/tree"))
    if (!res.ok) return {}
    return res.json()
  }

  async readFile(path: string): Promise<string | null> {
    const res = await fetch(this.url(`/content/${path}.md`))
    if (!res.ok) return null
    return res.text()
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fetch(this.url(`/content/${path}.md`), {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: content,
    })
  }

  async deleteFile(path: string): Promise<void> {
    await fetch(this.url(`/content/${path}.md`), { method: "DELETE" })
  }

  async moveFile(from: string, to: string): Promise<void> {
    const res = await fetch(this.url("/api/move"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${from}.md`, to: `${to}.md` }),
    })
    if (!res.ok) throw new Error(`Move failed: ${res.status}`)
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
    if (!resp.ok) throw new Error(`Upload failed: ${resp.statusText}`)
    const result = await resp.json()
    return result.url
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
    const params = new URLSearchParams({ dir })
    if (refs) params.set("refs", "true")
    const resp = await fetch(this.url(`/api/images?${params}`))
    if (!resp.ok) throw new Error(`Failed to list images: ${resp.statusText}`)
    const data = await resp.json()
    return data.images.map((img: any) => ({
      name: img.name,
      url: img.url,
      storageUrl: `image/${img.name}`,
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
    if (!resp.ok) throw new Error(`Failed to delete image: ${resp.statusText}`)
  }
}