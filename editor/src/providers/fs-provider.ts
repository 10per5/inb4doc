import type { ContentProvider, ImageEntry, SearchResult } from "@/providers/provider"
import type { TreeIndex } from "@/utils/tree"
import { DEFAULT_WEIGHT, buildTreeIndex } from "@/utils/tree"
import { ProviderType } from "@/providers/index"
import { stripFrontmatter } from "@/utils/frontmatter"
import { extractSnippets, contentMatches } from "@/utils/content-search"
import { sanitizeImageName } from "@/utils/sanitize"
import { hasFunc, AppFunc } from "$/build/build-mode"
import { pickProjectDirectory } from "@/bridge/native"
import { SafProvider } from "@/providers/saf-provider"

export class FileSystemProvider implements ContentProvider {
  readonly name = ProviderType.Filesystem
  private dirHandle: FileSystemDirectoryHandle | null = null
  private imageUrlCache = new Map<string, string>()
  private currentDir: string = ""
  private safDelegate: SafProvider | null = null
  private mobileInit = false

  /** On Android (GuiMobile) there is no showDirectoryPicker; the FS provider
   *  delegates to the SAF layer and its "pick" IS the native folder picker. */
  private isMobile(): boolean {
    return (
      hasFunc(AppFunc.SafProvider) &&
      typeof (window as any).showDirectoryPicker !== "function"
    )
  }

  private delegate(): SafProvider {
    if (!this.safDelegate) this.safDelegate = new SafProvider()
    return this.safDelegate
  }

  /** On mobile, show the native SAF picker once (on first real use). */
  private async ensurePicked(): Promise<void> {
    if (this.mobileInit) return
    this.mobileInit = true
    const info = await pickProjectDirectory()
    if (info) await this.delegate().setRoot(info.path)
  }

  async isAvailable(): Promise<boolean> {
    if (this.isMobile()) return true
    return typeof (window as any).showDirectoryPicker === "function"
  }

  async init(): Promise<void> {
    if (this.isMobile()) {
      await this.ensurePicked()
      return
    }
    if (this.dirHandle) return
    this.dirHandle = await (window as any).showDirectoryPicker()
  }

  async getTree(): Promise<TreeIndex> {
    if (this.isMobile()) {
      await this.ensurePicked()
      return this.delegate().getTree()
    }
    if (!this.dirHandle) await this.init()
    const paths: string[] = []
    const folderWeights: Record<string, number> = {}
    const fileWeights: Record<string, number> = {}
    await this.walkDir(this.dirHandle!, paths, folderWeights, fileWeights, "")
    return buildTreeIndex({ paths, children: {}, folderWeights, fileWeights })
  }

  private async walkDir(
    dir: FileSystemDirectoryHandle,
    paths: string[],
    folderWeights: Record<string, number>,
    fileWeights: Record<string, number>,
    prefix: string,
  ): Promise<void> {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith(".")) continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === "directory") {
        await this.walkDir(entry as FileSystemDirectoryHandle, paths, folderWeights, fileWeights, relPath)
      } else if (entry.name.endsWith(".md")) {
        const pagePath = relPath.replace(/\.md$/, "")
        paths.push(pagePath)
        const file = await (entry as FileSystemFileHandle).getFile()
        const text = await file.text()
        const match = text.match(/^---\n([\s\S]*?)\n---/)
        if (match) {
          const weightMatch = match[1].match(/^weight:\s*(\d+)/m)
          if (weightMatch) {
            const weight = parseInt(weightMatch[1], 10)
            if (entry.name === "_index.md") {
              folderWeights[pagePath.replace(/\/_index$/, "")] = weight
            } else {
              fileWeights[pagePath] = weight
            }
          }
        }
      }
    }
  }

  async readFile(path: string): Promise<string | null> {
    if (this.isMobile()) return this.delegate().readFile(path)
    if (!this.dirHandle) await this.init()
    const parts = path.split("/").filter(Boolean)
    let current: FileSystemDirectoryHandle = this.dirHandle!
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i])
    }
    const fileName = parts[parts.length - 1] + ".md"
    try {
      const fileHandle = await current.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return await file.text()
    } catch {
      return null
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.isMobile()) return this.delegate().writeFile(path, content)
    if (!this.dirHandle) await this.init()
    const parts = path.split("/").filter(Boolean)
    let current: FileSystemDirectoryHandle = this.dirHandle!
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i], { create: true })
    }
    const fileName = parts[parts.length - 1] + ".md"
    const fileHandle = await current.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async deleteFile(path: string): Promise<void> {
    if (this.isMobile()) return this.delegate().deleteFile(path)
    if (!this.dirHandle) await this.init()
    const parts = path.split("/").filter(Boolean)
    const dir = parts.slice(0, -1).join("/")
    let current: FileSystemDirectoryHandle = this.dirHandle!
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i])
    }
    const fileName = parts[parts.length - 1] + ".md"
    await current.removeEntry(fileName)
    await this.cleanupEmptyParents(current, parts.slice(0, -1))
    await this.removeOrphanedImages(dir)
  }

  async deleteFiles(paths: string[]): Promise<void> {
    if (this.isMobile()) return this.delegate().deleteFiles(paths)
    const dirs = new Set<string>()
    for (const path of paths) {
      const parts = path.split("/").filter(Boolean)
      if (parts.length === 0) continue
      let current: FileSystemDirectoryHandle = this.dirHandle!
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i])
      }
      const fileName = parts[parts.length - 1] + ".md"
      try {
        await current.removeEntry(fileName)
        await this.cleanupEmptyParents(current, parts.slice(0, -1))
      } catch {}
      const dir = parts.slice(0, -1).join("/")
      if (dir) dirs.add(dir)
    }
    for (const dir of dirs) {
      await this.removeOrphanedImages(dir)
    }
  }

  private async cleanupEmptyParents(dir: FileSystemDirectoryHandle, parts: string[]): Promise<void> {
    if (parts.length === 0) return
    for await (const _ of dir.values()) {
      return
    }
    const parentName = parts.pop()
    if (!parentName) return
    const parent = await this.getParentDir(parts)
    if (parent) {
      try {
        await parent.removeEntry(parentName)
        await this.cleanupEmptyParents(parent, parts)
      } catch {}
    }
  }

  private async getParentDir(parts: string[]): Promise<FileSystemDirectoryHandle | null> {
    if (!this.dirHandle) return null
    if (parts.length === 0) return this.dirHandle
    let current: FileSystemDirectoryHandle = this.dirHandle
    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part)
      } catch {
        return null
      }
    }
    return current
  }

  async moveFile(from: string, to: string): Promise<void> {
    if (this.isMobile()) return this.delegate().moveFile(from, to)
    const content = await this.readFile(from)
    if (content === null) throw new Error("Source not found")
    await this.writeFile(to, content)
    await this.deleteFile(from)
  }

  async search(query: string): Promise<SearchResult[]> {
    if (this.isMobile()) return this.delegate().search(query)
    if (!this.dirHandle) await this.init()
    return this.searchInDir(this.dirHandle!, "", query)
  }

  private async searchInDir(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    query: string,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    for await (const entry of dir.values()) {
      if (entry.name.startsWith(".")) continue
      if (entry.kind === "directory") {
        if (entry.name === "image") continue
        const sub = await this.searchInDir(
          entry as FileSystemDirectoryHandle,
          prefix ? `${prefix}/${entry.name}` : entry.name,
          query,
        )
        results.push(...sub)
      } else if (entry.name.endsWith(".md")) {
        const file = await (entry as FileSystemFileHandle).getFile()
        const body = await file.text()
        if (contentMatches(body, query)) {
          const full = prefix ? `${prefix}/${entry.name}` : entry.name
          results.push({
            path: full.replace(/\.md$/, ""),
            snippets: extractSnippets(body, query),
          })
        }
      }
    }
    return results
  }

  async getServerTime(path: string): Promise<number | null> {
    if (this.isMobile()) return this.delegate().getServerTime(path)
    if (!this.dirHandle) await this.init()
    const parts = path.split("/").filter(Boolean)
    let current: FileSystemDirectoryHandle = this.dirHandle!
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i])
    }
    const fileName = parts[parts.length - 1] + ".md"
    try {
      const fileHandle = await current.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return file.lastModified
    } catch {
      return null
    }
  }

  private async ensureImageDir(dir: string): Promise<FileSystemDirectoryHandle> {
    if (!this.dirHandle) await this.init()
    const parts = dir.split("/").filter(Boolean)
    let current: FileSystemDirectoryHandle = this.dirHandle!
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: true })
    }
    return await current.getDirectoryHandle("image", { create: true })
  }

  async uploadImage(file: File, dir: string): Promise<string> {
    if (this.isMobile()) return this.delegate().uploadImage(file, dir)
    const name = sanitizeImageName(file.name)
    const relPath = `image/${name}`
    const imageDir = await this.ensureImageDir(dir)
    const fileHandle = await imageDir.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(file)
    await writable.close()
    const blobUrl = URL.createObjectURL(file)
    this.imageUrlCache.set(`${dir}/${relPath}`, blobUrl)
    return `/${dir}/${relPath}`
  }

  resolveImageUrl(url: string): string | undefined {
    if (this.isMobile()) return this.delegate().resolveImageUrl(url)
    const normalized = url.startsWith("/") ? url.slice(1) : url
    const exact = this.imageUrlCache.get(normalized)
    if (exact) return exact
    if (this.currentDir) {
      return this.imageUrlCache.get(`${this.currentDir}/${normalized}`)
    }
    return undefined
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
    if (this.isMobile()) return this.delegate().listImages(dir, refs)
    this.currentDir = dir
    let imageDir: FileSystemDirectoryHandle
    try {
      imageDir = await this.ensureImageDir(dir)
    } catch {
      return []
    }
    const entries: ImageEntry[] = []
    const imageNames: string[] = []

    for await (const entry of imageDir.values()) {
      if (entry.kind !== "file") continue
      const name = entry.name
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
      if (!["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) continue
      imageNames.push(name)
    }

    imageNames.sort()

    const scanDir = dir ? dir : ""
    const mdFiles = refs ? await this.collectMdFiles(scanDir) : new Map<string, string>()

    for (const name of imageNames) {
      const storageUrl = `image/${name}`
      const cacheKey = `${dir}/${storageUrl}`
      let displayUrl = this.imageUrlCache.get(cacheKey)
      if (!displayUrl) {
        displayUrl = this.imageUrlCache.get(storageUrl)
      }
      if (!displayUrl) {
        try {
          const imageDir = await this.ensureImageDir(dir)
          const fileHandle = await imageDir.getFileHandle(name)
          const file = await fileHandle.getFile()
          displayUrl = URL.createObjectURL(file)
          this.imageUrlCache.set(cacheKey, displayUrl)
        } catch {
          displayUrl = ""
        }
      }
      const usedIn = refs ? this.findRefsInFiles(name, mdFiles) : []
      entries.push({ name, url: displayUrl, storageUrl: `/${dir}/${storageUrl}`, usedIn })
    }

    return entries
  }

  private async collectMdFiles(dir: string): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    if (!this.dirHandle) await this.init()

    async function walk(
      handle: FileSystemDirectoryHandle,
      prefix: string,
      skipImage: boolean,
      out: Map<string, string>,
    ) {
      for await (const entry of handle.values()) {
        if (entry.name.startsWith(".")) continue
        if (entry.kind === "directory") {
          if (skipImage && entry.name === "image") continue
          await walk(entry as FileSystemDirectoryHandle, prefix ? `${prefix}/${entry.name}` : entry.name, skipImage, out)
        } else if (entry.name.endsWith(".md")) {
          const file = await (entry as FileSystemFileHandle).getFile()
          const text = await file.text()
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          out.set(rel, text)
        }
      }
    }

    let handle = this.dirHandle!
    if (dir) {
      const parts = dir.split("/").filter(Boolean)
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part)
      }
    }
    await walk(handle, dir, true, result)
    return result
  }

  private findRefsInFiles(imageName: string, files: Map<string, string>): string[] {
    const refs: string[] = []
    for (const [relPath, content] of files) {
      if (content.includes(imageName)) {
        refs.push(relPath)
      }
    }
    return refs
  }

  async deleteImage(name: string, dir: string): Promise<void> {
    if (this.isMobile()) return this.delegate().deleteImage(name, dir)
    try {
      const imageDir = await this.ensureImageDir(dir)
      await imageDir.removeEntry(name)
    } catch {}
  }

  async renameImage(name: string, dir: string, newName: string): Promise<string> {
    if (this.isMobile()) return this.delegate().renameImage(name, dir, newName)
    const imageDir = await this.ensureImageDir(dir)
    const srcHandle = await imageDir.getFileHandle(name)
    const file = await srcHandle.getFile()
    const dstHandle = await imageDir.getFileHandle(newName, { create: true })
    const writable = await dstHandle.createWritable()
    await writable.write(file)
    await writable.close()
    await imageDir.removeEntry(name)
    const relPath = `image/${newName}`
    const blobUrl = URL.createObjectURL(file)
    this.imageUrlCache.set(`${dir}/${relPath}`, blobUrl)
    return `/${dir}/${relPath}`
  }

  private async removeOrphanedImages(dir: string): Promise<void> {
    let imageDir: FileSystemDirectoryHandle
    try {
      imageDir = await this.ensureImageDir(dir)
    } catch {
      return
    }
    const mdFiles = await this.collectMdFiles(dir)
    for await (const entry of imageDir.values()) {
      if (entry.kind !== "file") continue
      const refs = this.findRefsInFiles(entry.name, mdFiles)
      if (refs.length === 0) {
        try { await imageDir.removeEntry(entry.name) } catch {}
      }
    }
  }
}
