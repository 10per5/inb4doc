import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import { showNotification } from "@/components/notification/notification"

const STORAGE_PREFIX = "inb4doc:"

export async function exportToZip(): Promise<void> {
  const files: Record<string, Uint8Array> = {}
  let count = 0

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(STORAGE_PREFIX)) {
      const relPath = key.slice(STORAGE_PREFIX.length)
      const content = localStorage.getItem(key)
      if (content) {
        files[relPath] = strToU8(content)
        count++
      }
    }
  }

  if (count === 0) {
    showNotification("No files to export", { type: "warning" })
    return
  }

  const zipped = zipSync(files, { level: 0 })
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
