import type { ContentProvider, ImageEntry, SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { extractSnippets, contentMatches } from "@/utils/content-search"
import { imageKey, IMAGE_PREFIX, STORE_FILES, type FileEntry } from "@/config/storage-keys"
import { storageService } from "@/services/storage"
import { imageStore } from "@/stores/image-store"



export class LocalStorageProvider implements ContentProvider {
  readonly name = ProviderType.LocalStorage

  private get providerId(): string {
    return String(this.name)
  }

  private fileId(path: string): string {
    return `${this.providerId}/${path}`
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async getTree(): Promise<TreeIndex> {
    const paths: string[] = []
    const folderWeights: Record<string, number> = {}
    const fileWeights: Record<string, number> = {}

    const files = storageService.loadProviderFiles(this.providerId)
    for (const [relPath, entry] of Object.entries(files)) {
      if (!entry.content) continue
      paths.push(relPath)
      const match = entry.content.match(/^---\n([\s\S]*?)\n---/)
      if (match) {
        const weightMatch = match[1].match(/^weight:\s*(\d+)/m)
        if (weightMatch) {
          const weight = parseInt(weightMatch[1], 10)
          if (relPath.endsWith("/_index")) {
            folderWeights[relPath.replace(/\/_index$/, "")] = weight
          } else {
            fileWeights[relPath] = weight
          }
        }
      }
    }

    return buildTreeIndex({ paths, children: {}, folderWeights, fileWeights })
  }

  async readFile(path: string): Promise<string | null> {
    const entry = storageService.getJSON<FileEntry>(STORE_FILES, this.fileId(path))
    if (entry?.content !== undefined) return entry.content
    return null
  }

  async writeFile(path: string, content: string): Promise<void> {
    const existing = storageService.getJSON<FileEntry>(STORE_FILES, this.fileId(path)) ?? { dirty: false }
    storageService.setJSON(STORE_FILES, this.fileId(path), { ...existing, content, serverTime: Date.now() })
  }

  async deleteFile(path: string, keepImages?: boolean): Promise<void> {
    storageService.removeEntity(STORE_FILES, this.fileId(path))
    if (!keepImages) this.removeOrphanedImages()
  }

  async deleteFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
      storageService.removeEntity(STORE_FILES, this.fileId(path))
    }
    this.removeOrphanedImages()
  }

  async moveFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    if (content === null) throw new Error("Source not found")
    await this.deleteFile(from, true)
    await this.writeFile(to, content)
    this.removeOrphanedImages()
  }

  async getServerTime(path: string): Promise<number | null> {
    const entry = storageService.getJSON<FileEntry>(STORE_FILES, this.fileId(path))
    return entry?.serverTime ?? null
  }

  async search(query: string): Promise<SearchResult[]> {
    const files = storageService.loadProviderFiles(this.providerId)
    const results: SearchResult[] = []
    for (const [path, entry] of Object.entries(files)) {
      if (entry.content && contentMatches(entry.content, query)) {
        results.push({ path, snippets: extractSnippets(entry.content, query) })
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
    imageStore.setImage(name, base64)
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
      return imageStore.getImage(name) ?? undefined
    }
    return undefined
  }

  private findRefs(imageName: string): string[] {
    const refs: string[] = []
    const files = storageService.loadProviderFiles(this.providerId)
    for (const [path, entry] of Object.entries(files)) {
      if (entry.content && entry.content.includes(`inb4doc-image:${imageName}`)) {
        refs.push(path)
      }
    }
    return refs
  }

  async deleteImage(name: string, _dir: string): Promise<void> {
    imageStore.deleteImage(name)
  }

  private removeOrphanedImages(): void {
    const names = storageService.listImageNames()
    for (const name of names) {
      const refs = this.findRefs(name)
      if (refs.length === 0) {
        imageStore.deleteImage(name)
      }
    }
  }
}
