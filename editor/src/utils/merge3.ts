export type MergeResult = {
  merged: string
  conflicts: number
}

/**
 * LCS-based 3-way line merge.
 *
 * Used by per-section formatting: `ours` is the raw on-disk baseline, `base`
 * (C0) is the canonical serialization of that baseline, and `theirs` is the
 * canonical serialization after the user's edits. Regions the user did not
 * touch keep the raw formatting; only the blocks they edited come out
 * canonical. A whole-file format bypasses this and writes `theirs` directly.
 *
 * This is a real diff3 (LCS alignment + overlap-merging), NOT a naive
 * index-by-index comparison — the latter mis-aligns as soon as a block is
 * inserted in the middle and would garble untouched sections.
 */

// Cap the LCS DP table (~ n*m cells). Beyond this the doc is too large to
// merge cheaply; fall back to writing the canonical `theirs` unchanged.
const MAX_DP_CELLS = 4_000_000

function eqRange(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
): boolean {
  if (aEnd - aStart !== bEnd - bStart) return false
  for (let i = aStart, j = bStart; i < aEnd; i++, j++) {
    if (a[i] !== b[j]) return false
  }
  return true
}

/** Maximal LCS matching between two line arrays, as (aIndex, bIndex) pairs. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  // dp[i][j] = length of the LCS of a[i..] and b[j..]
  const dp: Int32Array[] = new Array(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? next[j + 1] + 1
          : next[j] > row[j + 1]
            ? next[j]
            : row[j + 1]
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

type Hunk = { oStart: number; oEnd: number; sStart: number; sEnd: number }

/** Hunks that turn `base` into `other`, expressed as base-index ranges. */
function diffIndices(base: string[], other: string[]): Hunk[] {
  const pairs = lcsPairs(base, other)
  const hunks: Hunk[] = []
  let lb = 0
  let lo = 0
  for (const [bi, oi] of pairs) {
    if (bi > lb || oi > lo) {
      hunks.push({ oStart: lb, oEnd: bi, sStart: lo, sEnd: oi })
    }
    lb = bi + 1
    lo = oi + 1
  }
  if (lb < base.length || lo < other.length) {
    hunks.push({ oStart: lb, oEnd: base.length, sStart: lo, sEnd: other.length })
  }
  return hunks
}

export function merge3(ours: string, base: string, theirs: string): MergeResult {
  const o = ours.replace(/\r\n/g, "\n")
  const b = base.replace(/\r\n/g, "\n")
  const t = theirs.replace(/\r\n/g, "\n")

  if (o === b) return { merged: t, conflicts: 0 }
  if (b === t) return { merged: o, conflicts: 0 }

  const ol = o.split("\n")
  const bl = b.split("\n")
  const tl = t.split("\n")

  if (bl.length * tl.length > MAX_DP_CELLS || bl.length * ol.length > MAX_DP_CELLS) {
    return { merged: t, conflicts: 0 }
  }

  const ha = diffIndices(bl, ol) // base -> ours
  const hb = diffIndices(bl, tl) // base -> theirs

  const out: string[] = []
  let conflicts = 0
  let ai = 0
  let bi = 0
  let oPos = 0

  while (ai < ha.length || bi < hb.length) {
    const aStart = ai < ha.length ? ha[ai].oStart : Infinity
    const bStart = bi < hb.length ? hb[bi].oStart : Infinity
    const regionStart = Math.min(aStart, bStart)

    // Emit unchanged base lines up to the next changed region.
    while (oPos < regionStart) {
      out.push(bl[oPos])
      oPos++
    }

    // Gather every hunk (either side) that overlaps this region.
    let regionEnd = -1
    let aSliceStart = Infinity
    let aSliceEnd = -Infinity
    let bSliceStart = Infinity
    let bSliceEnd = -Infinity
    let touchedA = false
    let touchedB = false

    for (;;) {
      const na = ai < ha.length ? ha[ai] : null
      const nb = bi < hb.length ? hb[bi] : null
      let took = false
      const condA =
        !!na && (regionEnd === -1 ? na.oStart === regionStart : na.oStart < regionEnd)
      const condB =
        !!nb && (regionEnd === -1 ? nb.oStart === regionStart : nb.oStart < regionEnd)
      if (condA && na) {
        regionEnd = regionEnd === -1 ? na.oEnd : Math.max(regionEnd, na.oEnd)
        aSliceStart = Math.min(aSliceStart, na.sStart)
        aSliceEnd = Math.max(aSliceEnd, na.sEnd)
        ai++
        touchedA = true
        took = true
      }
      if (condB && nb) {
        regionEnd = regionEnd === -1 ? nb.oEnd : Math.max(regionEnd, nb.oEnd)
        bSliceStart = Math.min(bSliceStart, nb.sStart)
        bSliceEnd = Math.max(bSliceEnd, nb.sEnd)
        bi++
        touchedB = true
        took = true
      }
      if (!took) break
    }

    if (touchedA && touchedB) {
      // Both sides changed an overlapping region. Prefer theirs (user edits);
      // count a conflict only when the two actually disagree.
      if (!eqRange(ol, aSliceStart, aSliceEnd, tl, bSliceStart, bSliceEnd)) {
        conflicts++
      }
      for (let k = bSliceStart; k < bSliceEnd; k++) out.push(tl[k])
    } else if (touchedA) {
      // Only normalization changed this region — keep the raw formatting.
      for (let k = aSliceStart; k < aSliceEnd; k++) out.push(ol[k])
    } else {
      // Only user edits changed this region.
      for (let k = bSliceStart; k < bSliceEnd; k++) out.push(tl[k])
    }
    oPos = regionEnd
  }

  while (oPos < bl.length) {
    out.push(bl[oPos])
    oPos++
  }

  let merged = out.join("\n")
  if (t.endsWith("\n") && !merged.endsWith("\n")) merged += "\n"
  return { merged, conflicts }
}
