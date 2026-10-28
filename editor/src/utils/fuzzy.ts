/**
 * Tiny subsequence fuzzy matcher — used by the file jumper.
 *
 * Returns 0 when `query` is not a subsequence of `text` (so callers can treat
 * 0 as "no match" and still use the score for ordering), otherwise a score
 * that rewards consecutive runs, matches at word/segment boundaries, and
 * shorter haystacks.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const t = text.toLowerCase()

  let score = 0
  let ti = 0
  let run = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    if (found === ti && qi > 0) {
      run++
      score += 6 + run * 2
    } else {
      run = 0
      score += 1
    }
    const prev = found > 0 ? t[found - 1] : "/"
    if (found === 0) score += 8
    else if (prev === "/" || prev === "-" || prev === "_" || prev === " " || prev === ".") score += 6
    else if (t[found] !== text[found]) score += 1 // case mismatch, still a hit
    ti = found + 1
  }
  // Shorter targets win ties, and a match in the file's own name beats one that
  // only lines up across its folder path.
  score += Math.max(0, 24 - text.length) / 8
  return score
}
