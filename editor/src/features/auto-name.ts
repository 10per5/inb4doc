/**
 * Auto-naming for files created without a name.
 *
 * "New" no longer asks for a filename: the file is created under a throwaway
 * three-word slug (`quiet-river-stone`) and takes its real name from whatever
 * the user types in the first `# heading` — which every markdown document has
 * anyway, so nobody fills in a name twice.
 *
 * Only files this flow created are auto-renamed (the set below is a session
 * marker), and only while they still have a pending Create: once the file has
 * a name worth keeping — or the user renames it from the explorer — the marker
 * goes away and renaming becomes explicit again. Deleting the heading line
 * therefore does NOT wipe the name: it simply stops inferring, which is the
 * file-explorer UI's job from then on.
 */

const autoNamed = new Set<string>()

export function markAutoNamed(path: string): void {
  if (path) autoNamed.add(path)
}

export function clearAutoNamed(path: string): void {
  autoNamed.delete(path)
}

export function isAutoNamed(path: string): boolean {
  return autoNamed.has(path)
}

const ADJECTIVES = [
  "amber",
  "bold",
  "calm",
  "clever",
  "crisp",
  "eager",
  "fleet",
  "gentle",
  "hollow",
  "lucid",
  "noble",
  "quiet",
  "rapid",
  "silent",
  "steady",
  "sunny",
  "tidy",
  "vivid",
  "witty",
  "zesty",
]

const NOUNS = [
  "atlas",
  "beacon",
  "canyon",
  "cipher",
  "compass",
  "delta",
  "ember",
  "forest",
  "glade",
  "harbor",
  "lantern",
  "meadow",
  "orbit",
  "pilot",
  "prism",
  "quartz",
  "river",
  "summit",
  "tower",
  "voyage",
]

const CONNECTORS = ["of", "and", "the", "in", "on", "at", "by", "for"]

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** Three hyphenated words — `words-like-this` — ready to be a Hugo slug. */
export function randomSlug(): string {
  return [pick(ADJECTIVES), pick(CONNECTORS), pick(NOUNS)].join("-")
}

/** Slugify a heading into a Hugo-safe filename fragment. */
export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

/** The slug a document's first `# heading` asks for, or null if it has none. */
export function slugFromFirstHeading(md: string): string | null {
  const line = firstHeadingText(md)
  if (!line) return null
  return slugifyTitle(line) || null
}

/**
 * What the first heading says this file should be called, or null when it says
 * nothing new (no heading, or its slug already matches the current name). A
 * deleted heading yields null — the file keeps its name and the explorer UI
 * becomes the only way to rename it, exactly as intended.
 */
export function inferTargetPath(path: string, md: string): string | null {
  const slug = slugFromFirstHeading(md)
  if (!slug) return null
  const current = path.split("/").pop() ?? ""
  if (slug === current) return null
  const slash = path.lastIndexOf("/")
  return slash === -1 ? slug : `${path.slice(0, slash)}/${slug}`
}

/** Text of the first ATX heading in the markdown body ("" when there is none). */
function firstHeadingText(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "")
  for (const raw of body.split("\n")) {
    const line = raw.trim()
    if (line === "") continue
    const match = line.match(/^#{1,6}\s+(.*)$/)
    return match ? match[1].trim() : ""
  }
  return ""
}
