import { loadPrefs } from "../storage"
import { getProvider } from "../content/provider-registry"
import type { ImageEntry } from "../content/provider"
import { imageRegistry } from "./image-registry"

let currentDocDir = ""

export function setCurrentDocDir(dir: string) {
  currentDocDir = dir
}

export function getCurrentDocDir(): string {
  return currentDocDir
}

export function isBase64Mode(): boolean {
  return loadPrefs().imageStorageMode === "base64"
}

export async function uploadImage(file: File): Promise<string> {
  if (isBase64Mode()) {
    return readFileAsBase64(file)
  }
  const provider = getProvider()
  if (provider.uploadImage) {
    return imageRegistry.addPending(file, currentDocDir)
  }
  return readFileAsBase64(file)
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function commitPendingImages(dir: string): Promise<Map<string, string>> {
  if (!imageRegistry.hasPending(dir)) return new Map()
  const provider = getProvider()
  const upload = async (file: File, d: string) => {
    if (provider.uploadImage) {
      return provider.uploadImage(file, d)
    }
    return readFileAsBase64(file)
  }
  return imageRegistry.commitPending(dir, upload)
}

export async function commitAllPendingImages(): Promise<Map<string, string>> {
  const combined = new Map<string, string>()
  const dirs = imageRegistry.getAllPendingDirs()
  for (const dir of dirs) {
    const map = await commitPendingImages(dir)
    for (const [k, v] of map) {
      combined.set(k, v)
    }
  }
  return combined
}

export function replacePendingUrls(body: string, urlMap: Map<string, string>): string {
  let result = body
  for (const [pendingUrl, realUrl] of urlMap) {
    result = result.split(pendingUrl).join(realUrl)
  }
  return result
}

export async function listImages(refs?: boolean): Promise<ImageEntry[]> {
  const provider = getProvider()
  if (provider.listImages) {
    const known = await provider.listImages(currentDocDir, refs)
    imageRegistry.setKnown(currentDocDir, known)
    return known
  }
  return []
}

export function getAllImages(): (ImageEntry & { pending?: boolean })[] {
  const known = imageRegistry.getKnown(currentDocDir)
  const pending = imageRegistry.getPending(currentDocDir).map(p => ({
    name: p.id,
    url: p.blobUrl,
    storageUrl: p.blobUrl,
    usedIn: [] as string[],
    pending: true as const,
  }))
  return [...known, ...pending]
}

export async function deleteImage(name: string): Promise<void> {
  if (name.startsWith("pi-")) {
    await imageRegistry.removePending(name)
    return
  }
  const provider = getProvider()
  if (provider.deleteImage) {
    return provider.deleteImage(name, currentDocDir)
  }
}
