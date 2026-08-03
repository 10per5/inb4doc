import type { MetaPanelData } from "@/entities/Frontmatter"
import { DEFAULT_WEIGHT } from "@/utils/tree"

export function parseFrontmatter(raw: string): MetaPanelData {
  const data: MetaPanelData = { title: "" }
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)/)
    if (m) {
      const val = m[2].trim()
      if (m[1] === "weight") {
        const w = parseInt(val, 10)
        data.weight = Number.isNaN(w) ? DEFAULT_WEIGHT : w
      } else data[m[1]] = val
    }
  }
  return data
}

export function serializeFrontmatter(data: MetaPanelData): string {
  const lines: string[] = []
  if (data.title) lines.push(`title: ${data.title}`)
  if (data.weight != null) lines.push(`weight: ${data.weight}`)
  for (const [key, val] of Object.entries(data)) {
    if (key !== "title" && key !== "weight" && val !== undefined) {
      lines.push(`${key}: ${val}`)
    }
  }
  return lines.join("\n")
}

export function stripFrontmatter(content: string): {
  frontmatter: MetaPanelData | null
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (match) {
    return {
      frontmatter: parseFrontmatter(match[1]),
      body: content.slice(match[0].length).replace(/^\n/, ''),
    }
  }
  return { frontmatter: null, body: content }
}