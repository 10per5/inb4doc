import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import { showNotification } from "@/components/notification/notification"
import { storageService } from "@/services/storage-service"
import { IMAGE_PREFIX } from "@/config/storage-keys"

const IMAGE_DATA_PREFIX = "inb4doc:image:"

function u8ToBase64(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export async function exportToZip(): Promise<void> {
  const files: Record<string, Uint8Array> = {}
  let count = 0

  storageService.forEachFile((_providerId, path, entry) => {
    if (entry.content) {
      files[`${path}.md`] = strToU8(entry.content)
      count++
    }
  })

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue

    if (key.startsWith(IMAGE_DATA_PREFIX)) {
      const name = key.slice(IMAGE_DATA_PREFIX.length)
      const content = localStorage.getItem(key)
      if (content) {
        files[`images/${name}`] = strToU8(content)
        count++
      }
    }
  }

  if (count === 0) {
    showNotification("No files to export", { type: "warning" })
    return
  }

  const zipped = zipSync(files, { level: 0 })

  // Android WebView: a programmatic <a download> on a blob: URL is a silent
  // no-op (no download manager), so write the archive through the native bridge
  // into the user's Downloads collection instead. Everywhere else keeps the
  // anchor + object-URL download.
  const native = (window as any).NativeBridge
  if (native && typeof native.saveZip === "function") {
    const fileName = `inb4doc-backup-${new Date().toISOString().slice(0, 10)}.zip`
    try {
      const raw = native.saveZip(u8ToBase64(zipped), fileName)
      let ok = false
      if (typeof raw === "string") {
        try { ok = JSON.parse(raw).ok === true } catch { ok = false }
      }
      if (!ok) {
        showNotification("Failed to save zip", { type: "danger" })
        return
      }
    } catch {
      showNotification("Failed to save zip", { type: "danger" })
      return
    }
    showNotification(`Exported ${count} file${count > 1 ? "s" : ""}`, { type: "info" })
    return
  }

  const blob = new Blob([zipped], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `inb4doc-backup-${new Date().toISOString().slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  showNotification(`Exported ${count} file${count > 1 ? "s" : ""}`, { type: "info" })
}

export interface ZipEntry {
  relPath: string
  content: string
}

export interface ZipFileEntry extends ZipEntry {
  exists: boolean
}

export async function pickAndParseZip(): Promise<ZipEntry[] | null> {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".zip"

  const file = await new Promise<File | null>((resolve) => {
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null))
    input.click()
  })

  if (!file) return null

  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)

  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(data)
  } catch {
    showNotification("Failed to read zip file", { type: "danger" })
    return null
  }

  const entries: ZipEntry[] = []

  for (const [relPath, content] of Object.entries(extracted)) {
    if (!relPath.endsWith(".md")) continue
    const text = strFromU8(content)
    entries.push({ relPath, content: text })
  }

  if (entries.length === 0) {
    showNotification("No markdown files found in archive", { type: "warning" })
    return null
  }

  return entries
}
