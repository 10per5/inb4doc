import type { ProviderType } from "@/providers/index"
import type { TreeIndex } from "@/utils/tree"

export interface SearchResult {
  path: string;
  snippets: string[];
}

export interface ImageEntry {
  name: string
  url: string
  storageUrl: string
  usedIn: string[]
}

export interface ContentProvider {
  readonly name: ProviderType
  /** Check if this provider is reachable / supported in the current environment. */
  isAvailable(): Promise<boolean>
  getTree(): Promise<TreeIndex>
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>
  moveFile(from: string, to: string): Promise<void>
  getServerTime(path: string): Promise<number | null>
  search?(query: string): Promise<SearchResult[]>
  uploadImage?(file: File, dir: string): Promise<string>
  listImages?(dir: string, refs?: boolean): Promise<ImageEntry[]>
  deleteImage?(name: string, dir: string): Promise<void>
  resolveImageUrl?(url: string): string | undefined
}
