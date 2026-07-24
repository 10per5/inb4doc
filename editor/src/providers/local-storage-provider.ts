import type { ContentProvider, ImageEntry, SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { DEFAULT_WEIGHT, buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { extractSnippets, contentMatches } from "@/utils/content-search"

const STORAGE_PREFIX = "inb4doc:"
const IMAGE_PREFIX = "inb4doc:image:"

export class LocalStorageProvider implements ContentProvider {
  readonly name = ProviderType.LocalStorage

  async isAvailable(): Promise<boolean> {
    return true
  }

  async getTree(): Promise<TreeIndex> {
    const paths: string[] = []
    const folderWeights: Record<string, number> = {}

    const mdKeys = this.getAllMdKeys()
    for (const key of mdKeys) {
      const relPath = key.slice(STORAGE_PREFIX.length).replace(/\.md$/, "")
      paths.push(relPath)

      const content = localStorage.getItem(key)
      if (content) {
        const match = content.match(/^---\n([\s\S]*?)\n---/)
        if (match) {
          const weightMatch = match[1].match(/^weight:\s*(\d+)/m)
          if (weightMatch) {
            const weight = parseInt(weightMatch[1], 10)
            if (relPath.endsWith("/_index")) {
              folderWeights[relPath.replace(/\/_index$/, "")] = weight
            }
          }
        }
      }
    }

    return buildTreeIndex({ paths, children: {}, folderWeights })
  }

  private getAllMdKeys(): string[] {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX) && key.endsWith(".md")) {
        keys.push(key)
      }
    }
    return keys
  }

  async readFile(path: string): Promise<string | null> {
    return localStorage.getItem(STORAGE_PREFIX + path + ".md")
  }

  async writeFile(path: string, content: string): Promise<void> {
    localStorage.setItem(STORAGE_PREFIX + path + ".md", content)
  }

  async deleteFile(path: string): Promise<void> {
    localStorage.removeItem(STORAGE_PREFIX + path + ".md")
    const prefix = STORAGE_PREFIX + path + "/"
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key)
      }
    }
    this.removeOrphanedImages()
  }

  async moveFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    if (content === null) throw new Error("Source not found")
    await this.writeFile(to, content)
    await this.deleteFile(from)
  }

  async getServerTime(_path: string): Promise<number | null> {
    return Date.now()
  }

  async search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX) || !key.endsWith(".md")) continue
      const body = localStorage.getItem(key)
      if (body && contentMatches(body, query)) {
        results.push({
          path: key.slice(STORAGE_PREFIX.length).replace(/\.md$/, ""),
          snippets: extractSnippets(body, query),
        })
      }
    }
    return results
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async uploadImage(file: File, _dir: string): Promise<string> {
    const ext = file.name.includes(".") ? file.name.split(".").pop()! : "png"
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const base64 = await this.fileToBase64(file)
    localStorage.setItem(IMAGE_PREFIX + name, base64)
    return `inb4doc-image:${name}`
  }

  async listImages(_dir: string, refs?: boolean): Promise<ImageEntry[]> {
    const entries: ImageEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(IMAGE_PREFIX)) {
        const name = key.slice(IMAGE_PREFIX.length)
        const base64 = localStorage.getItem(key)!
        const usedIn = refs ? this.findRefs(name) : []
        entries.push({ name, url: base64, storageUrl: `inb4doc-image:${name}`, usedIn })
      }
    }
    return entries
  }

  resolveImageUrl(url: string): string | undefined {
    if (url.startsWith("inb4doc-image:")) {
      const name = url.slice("inb4doc-image:".length)
      return localStorage.getItem(IMAGE_PREFIX + name) || undefined
    }
    return undefined
  }

  private findRefs(imageName: string): string[] {
    const refs: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX) && key.endsWith(".md")) {
        const content = localStorage.getItem(key)
        if (content && content.includes(`inb4doc-image:${imageName}`)) {
          refs.push(key.slice(STORAGE_PREFIX.length))
        }
      }
    }
    return refs
  }

  async deleteImage(name: string, _dir: string): Promise<void> {
    localStorage.removeItem(IMAGE_PREFIX + name)
  }

  private removeOrphanedImages(): void {
    const imageKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(IMAGE_PREFIX)) {
        imageKeys.push(key)
      }
    }
    for (const key of imageKeys) {
      const name = key.slice(IMAGE_PREFIX.length)
      const refs = this.findRefs(name)
      if (refs.length === 0) {
        localStorage.removeItem(key)
      }
    }
  }
}
