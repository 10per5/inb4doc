import type { ContentProvider, TreeNode, ImageEntry, SearchResult } from "./provider"
import { stripFrontmatter } from "../utils/frontmatter"
import { extractSnippets, contentMatches } from "../utils/content-search"
import { sanitizeImageName } from "../utils/sanitize"

export class FileSystemProvider implements ContentProvider {
  readonly name = "fs"
  private dirHandle: FileSystemDirectoryHandle | null = null
  private imageUrlCache = new Map<string, string>()
  private currentDir: string = ""

  async init(): Promise<void> {
    if (this.dirHandle) return
    this.dirHandle = await (window as any).showDirectoryPicker()
  }

  async getTree(): Promise<TreeNode> {
    if (!this.dirHandle) await this.init()
    const result: TreeNode = {}
    await this.buildTree(this.dirHandle!, result)
    return result
  }

  private async buildTree(dir: FileSystemDirectoryHandle, out: TreeNode): Promise<void> {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith(".")) continue
      if (entry.kind === "directory") {
        const children: TreeNode = {}
        await this.buildTree(entry as FileSystemDirectoryHandle, children)
        if (Object.keys(children).length > 0) {
          out[entry.name] = children
        }
      } else if (entry.name.endsWith(".md")) {
        const file = await (entry as FileSystemFileHandle).getFile()
        const text = await file.text()
        const match = text.match(/^---\n([\s\S]*?)\n---/)
        if (match) {
          const weightMatch = match[1].match(/^weight:\s*(\d+)/m)
          if (weightMatch) {
            out[entry.name] = { weight: parseInt(weightMatch[1], 10) }
            continue
          }
        }
        out[entry.name] = null
      }
    }
  }

  async readFile(path: string): Promise<string | null> {
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
    const content = await this.readFile(from)
    if (content === null) throw new Error("Source not found")
    await this.writeFile(to, content)
    await this.deleteFile(from)
  }

  async search(query: string): Promise<SearchResult[]> {
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
    const name = sanitizeImageName(file.name)
    const relPath = `image/${name}`
    const imageDir = await this.ensureImageDir(dir)
    const fileHandle = await imageDir.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(file)
    await writable.close()
    const blobUrl = URL.createObjectURL(file)
    this.imageUrlCache.set(`${dir}/${relPath}`, blobUrl)
    return relPath
  }

  resolveImageUrl(url: string): string | undefined {
    const exact = this.imageUrlCache.get(url)
    if (exact) return exact
    if (this.currentDir) {
      return this.imageUrlCache.get(`${this.currentDir}/${url}`)
    }
    return undefined
  }

  async listImages(dir: string, refs?: boolean): Promise<ImageEntry[]> {
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
      entries.push({ name, url: displayUrl, storageUrl, usedIn })
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
    try {
      const imageDir = await this.ensureImageDir(dir)
      await imageDir.removeEntry(name)
    } catch {}
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