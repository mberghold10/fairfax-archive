/**
 * Player identity resolution across seasons.
 * Uses Jaro-Winkler similarity to cluster names that refer to the same player,
 * with jersey number as a tiebreaker when available.
 */

// ── Jaro-Winkler ────────────────────────────────────────────────────────────

function jaro(s1, s2) {
  if (s1 === s2) return 1
  const len1 = s1.length, len2 = s2.length
  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1
  const s1Matches = new Array(len1).fill(false)
  const s2Matches = new Array(len2).fill(false)
  let matches = 0, transpositions = 0

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist)
    const end   = Math.min(i + matchDist + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
}

export function jaroWinkler(s1, s2, p = 0.1) {
  const j = jaro(s1, s2)
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return j + prefix * p * (1 - j)
}

// ── Name normalization ──────────────────────────────────────────────────────

export function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Player clustering ───────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.88

/**
 * Given an array of {name, number, ...stats} entries from all seasons,
 * cluster them into canonical players using Jaro-Winkler + jersey number.
 *
 * Returns: Array of player profile objects sorted by career points descending.
 */
export function buildPlayerProfiles(seasons) {
  // Collect all player-season entries
  const entries = []
  for (const season of seasons) {
    for (const p of (season.skaters || [])) {
      if (!p.name || p.name.toLowerCase().includes('substitute')) continue
      entries.push({ ...p, seasonName: season.seasonName, seasonId: season.seasonId })
    }
  }

  // Cluster by name similarity + jersey number
  const clusters = [] // [{canonical, number, entries[]}]

  for (const entry of entries) {
    const norm = normalizeName(entry.name)
    const num  = entry.number?.toString().replace(/\D/g, '') || ''

    // Find best matching cluster
    let bestCluster = null
    let bestScore   = 0

    for (const cluster of clusters) {
      const nameSim = jaroWinkler(norm, cluster.canonical)
      // Boost score if jersey numbers match
      const numBoost = (num && cluster.number && num === cluster.number) ? 0.05 : 0
      const score = nameSim + numBoost
      if (score > SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore   = score
        bestCluster = cluster
      }
    }

    if (bestCluster) {
      bestCluster.entries.push(entry)
      // Update canonical jersey number if we now have one
      if (!bestCluster.number && num) bestCluster.number = num
    } else {
      clusters.push({ canonical: norm, displayName: entry.name, number: num, entries: [entry] })
    }
  }

  // Build profiles with totals and season-by-season breakdown
  const profiles = clusters
    .filter(c => c.entries.length > 0)
    .map(c => {
      // Pick display name: most common, or longest (most complete)
      const nameCounts = {}
      c.entries.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1 })
      const displayName = Object.entries(nameCounts)
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]

      // Pick jersey number: most common non-empty
      const numCounts = {}
      c.entries.forEach(e => {
        const n = e.number?.toString().replace(/\D/g, '')
        if (n) numCounts[n] = (numCounts[n] || 0) + 1
      })
      const number = Object.entries(numCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''

      // Aggregate totals
      const totals = { gp: 0, g: 0, a: 0, pts: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, pim: 0 }
      c.entries.forEach(e => {
        totals.gp  += e.gp  || 0
        totals.g   += e.g   || 0
        totals.a   += e.a   || 0
        totals.pts += e.pts || 0
        totals.ppg += e.ppg || 0
        totals.ppa += e.ppa || 0
        totals.shg += e.shg || 0
        totals.sha += e.sha || 0
        totals.pim += e.pim || 0
      })
      // Recalculate pts in case source data was inconsistent
      totals.pts = totals.g + totals.a

      // Season breakdown (deduplicated by seasonId+seasonName)
      const seen = new Set()
      const seasonBreakdown = c.entries
        .filter(e => {
          const key = e.seasonId || e.seasonName
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map(e => ({
          seasonName: e.seasonName,
          number: e.number || number,
          gp: e.gp || 0, g: e.g || 0, a: e.a || 0, pts: (e.g || 0) + (e.a || 0),
          ppg: e.ppg || 0, pim: e.pim || 0,
        }))
        .sort((a, b) => (b.seasonName || '').localeCompare(a.seasonName || ''))

      return { displayName, number, canonical: c.canonical, totals, seasons: seasonBreakdown }
    })
    .sort((a, b) => b.totals.pts - a.totals.pts)

  return profiles
}

/**
 * Build all-time goalie profiles similarly.
 */
export function buildGoalieProfiles(seasons) {
  const entries = []
  for (const season of seasons) {
    for (const g of (season.goalies || [])) {
      if (!g.name || g.name.toLowerCase().includes('substitute')) continue
      entries.push({ ...g, seasonName: season.seasonName, seasonId: season.seasonId })
    }
  }

  const clusters = []
  for (const entry of entries) {
    const norm = normalizeName(entry.name)
    let bestCluster = null, bestScore = 0
    for (const cluster of clusters) {
      const score = jaroWinkler(norm, cluster.canonical)
      if (score > SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score; bestCluster = cluster
      }
    }
    if (bestCluster) bestCluster.entries.push(entry)
    else clusters.push({ canonical: norm, displayName: entry.name, entries: [entry] })
  }

  return clusters
    .filter(c => c.entries.length > 0)
    .map(c => {
      const nameCounts = {}
      c.entries.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1 })
      const displayName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0][0]

      const totals = { gp: 0, w: 0, l: 0, t: 0, ga: 0, sa: 0, sv: 0, so: 0, pim: 0 }
      c.entries.forEach(e => {
        totals.gp  += e.gp  || 0
        totals.w   += e.w   || 0
        totals.l   += e.l   || 0
        totals.t   += e.t   || 0
        totals.ga  += e.ga  || 0
        totals.sa  += e.sa  || 0
        totals.sv  += e.sv  || 0
        totals.so  += e.so  || 0
        totals.pim += e.pim || 0
      })
      totals.svpct = totals.sa > 0 ? (totals.sv / totals.sa).toFixed(3) : '—'
      totals.gaa   = totals.gp > 0 ? (totals.ga / totals.gp).toFixed(2) : '—'

      const seen = new Set()
      const seasonBreakdown = c.entries
        .filter(e => { const k = e.seasonId || e.seasonName; if (seen.has(k)) return false; seen.add(k); return true })
        .map(e => ({ seasonName: e.seasonName, gp: e.gp||0, w: e.w||0, l: e.l||0, t: e.t||0, gaa: e.gaa||'', svpct: e.svpct||'' }))
        .sort((a, b) => (b.seasonName||'').localeCompare(a.seasonName||''))

      return { displayName, canonical: c.canonical, totals, seasons: seasonBreakdown }
    })
    .sort((a, b) => b.totals.w - a.totals.w)
}
