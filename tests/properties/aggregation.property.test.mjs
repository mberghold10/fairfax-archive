// Feature: fairfax-archive-site, Property 1: Season catalog completeness
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { buildCatalogFromMetas } from '../../scripts/aggregate/seasonCatalog.mjs'
import { buildSearchIndex } from '../../scripts/aggregate/searchIndex.mjs'
import { normalizeName, buildPlayerProfiles } from '../../src/utils/playerIdentity.mjs'

/**
 * **Validates: Requirements 3.1, 14.1, 14.2**
 *
 * Property 1: Season catalog completeness
 *
 * For any set of division metadata files with arbitrary season names and division IDs,
 * the Season Catalog builder SHALL produce an output containing every season name present
 * in the input, each mapped to all division IDs that reference that season, with correct
 * division labels and team lists.
 */

// --- Generators ---

// Arbitrary season name (e.g. "Winter 2016", "Summer 2023", "Fall 2008")
const seasonNameArb = fc.tuple(
  fc.constantFrom('Winter', 'Spring', 'Summer', 'Fall', 'Pre-Season', 'Holiday'),
  fc.integer({ min: 2000, max: 2030 })
).map(([term, year]) => `${term} ${year}`)

// Arbitrary division label (e.g. "MA", "MB", "C", "D1")
const divisionLabelArb = fc.stringMatching(/^[A-Z][A-Z0-9]{0,3}$/)

// Arbitrary team map: teamId → teamName
const teamMapArb = fc.dictionary(
  fc.integer({ min: 1, max: 9999 }).map(String),
  fc.stringMatching(/^[A-Za-z ]{2,20}$/).filter(s => s.trim().length > 0),
  { minKeys: 0, maxKeys: 8 }
)

// Arbitrary division ID (numeric string)
const divIdArb = fc.integer({ min: 1, max: 9999 }).map(String)

// An array of meta objects with unique divIds (1 to 30 divisions)
// In real data, each division directory has a unique numeric ID
const metasArb = fc.array(
  fc.record({
    seasonName: seasonNameArb,
    divisionLabel: divisionLabelArb,
    teams: teamMapArb
  }),
  { minLength: 1, maxLength: 30 }
).map(records =>
  records.map((r, i) => ({ ...r, divId: String(i + 1) }))
)

describe('Property 1: Season catalog completeness', () => {
  it('every season name in the input appears in the output catalog', () => {
    fc.assert(
      fc.property(metasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        // Collect all unique season names from input
        const inputSeasonNames = new Set(metas.map(m => m.seasonName))

        // All output season names
        const outputSeasonNames = new Set(catalog.seasons.map(s => s.seasonName))

        // Every input season must appear in output
        for (const name of inputSeasonNames) {
          expect(outputSeasonNames.has(name)).toBe(true)
        }

        // No extra seasons should appear
        expect(outputSeasonNames.size).toBe(inputSeasonNames.size)
      }),
      { numRuns: 100 }
    )
  })

  it('every division ID referencing a season is mapped under that season', () => {
    fc.assert(
      fc.property(metasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        // Build expected mapping: seasonName → Set of divIds
        const expected = new Map()
        for (const meta of metas) {
          if (!expected.has(meta.seasonName)) {
            expected.set(meta.seasonName, new Set())
          }
          expected.get(meta.seasonName).add(String(meta.divId))
        }

        // Verify each season in catalog has exactly the right divIds
        for (const season of catalog.seasons) {
          const expectedDivIds = expected.get(season.seasonName)
          const actualDivIds = new Set(season.divisions.map(d => d.divId))

          expect(actualDivIds).toEqual(expectedDivIds)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('division labels are correctly preserved in the output', () => {
    fc.assert(
      fc.property(metasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        // Build a lookup: divId → expected divisionLabel
        const expectedLabels = new Map()
        for (const meta of metas) {
          expectedLabels.set(String(meta.divId), meta.divisionLabel)
        }

        // Verify each division in the catalog has the correct label
        for (const season of catalog.seasons) {
          for (const div of season.divisions) {
            expect(div.divisionLabel).toBe(expectedLabels.get(div.divId))
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('team lists are correctly preserved in the output', () => {
    fc.assert(
      fc.property(metasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        // Build a lookup: divId → expected teams
        const expectedTeams = new Map()
        for (const meta of metas) {
          expectedTeams.set(String(meta.divId), meta.teams)
        }

        // Verify each division in the catalog has the correct teams
        for (const season of catalog.seasons) {
          for (const div of season.divisions) {
            expect(div.teams).toEqual(expectedTeams.get(div.divId))
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('accepts arbitrary season names without hardcoded restrictions (Req 14.1)', () => {
    // Use completely arbitrary strings as season names to verify no hardcoding
    const arbitrarySeasonNameArb = fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0)

    const arbitraryMetaArb = fc.record({
      seasonName: arbitrarySeasonNameArb,
      divisionLabel: divisionLabelArb,
      teams: teamMapArb,
      divId: divIdArb
    })

    const arbitraryMetasArb = fc.array(arbitraryMetaArb, { minLength: 1, maxLength: 20 })

    fc.assert(
      fc.property(arbitraryMetasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        const inputSeasonNames = new Set(metas.map(m => m.seasonName))
        const outputSeasonNames = new Set(catalog.seasons.map(s => s.seasonName))

        expect(outputSeasonNames).toEqual(inputSeasonNames)
      }),
      { numRuns: 100 }
    )
  })

  it('accepts arbitrary division ID ranges without assumptions (Req 14.2)', () => {
    // Use diverse division IDs including very large numbers
    const wideDivIdArb = fc.integer({ min: 1, max: 999999 }).map(String)

    const wideMetaArb = fc.record({
      seasonName: seasonNameArb,
      divisionLabel: divisionLabelArb,
      teams: teamMapArb,
      divId: wideDivIdArb
    })

    const wideMetasArb = fc.array(wideMetaArb, { minLength: 1, maxLength: 20 })

    fc.assert(
      fc.property(wideMetasArb, (metas) => {
        const catalog = buildCatalogFromMetas(metas)

        // Every unique divId should appear somewhere in the output
        const inputDivIds = new Set(metas.map(m => String(m.divId)))
        const outputDivIds = new Set()
        for (const season of catalog.seasons) {
          for (const div of season.divisions) {
            outputDivIds.add(div.divId)
          }
        }

        expect(outputDivIds).toEqual(inputDivIds)
      }),
      { numRuns: 100 }
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 2: Skater career totals equal sum of season stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.2, 3.4**
 *
 * Property 2: Skater career totals equal sum of season stats
 *
 * For any set of roster entries attributed to a single resolved player across
 * multiple seasons, the player's career totals (GP, G, A, PTS, PPG, PPA, SHG, SHA, PIM)
 * SHALL equal the sum of the corresponding fields from each individual season entry,
 * and PTS SHALL equal G + A.
 */

// --- Skater Season Generators ---

/** Generate a non-negative integer for stat fields */
const arbStat = fc.integer({ min: 0, max: 200 })

/** Generate a skater entry with consistent stats */
const arbSkater = (name) => fc.record({
  name: fc.constant(name),
  number: fc.integer({ min: 1, max: 99 }).map(String),
  gp: arbStat,
  g: arbStat,
  a: arbStat,
  pts: arbStat, // will be overridden by buildPlayerProfiles as g+a
  ppg: arbStat,
  ppa: arbStat,
  shg: arbStat,
  sha: arbStat,
  pim: arbStat,
})

/** Generate a season with a single skater (same name across seasons for clustering) */
const arbSeasonForPlayer = (name, index) => arbSkater(name).map(skater => ({
  seasonName: `Season ${index}`,
  seasonId: `s${index}`,
  skaters: [skater],
}))

/** Generate multiple seasons all referencing the same player name */
const arbSeasonsForSinglePlayer = fc.integer({ min: 1, max: 10 }).chain(numSeasons => {
  // Use a fixed player name so all entries cluster together
  const playerName = 'Smith, John'
  const seasonArbs = Array.from({ length: numSeasons }, (_, i) => arbSeasonForPlayer(playerName, i + 1))
  return fc.tuple(...seasonArbs)
})

describe('Property 2: Skater career totals equal sum of season stats', () => {
  it('career totals equal sum of individual season entries', () => {
    fc.assert(
      fc.property(arbSeasonsForSinglePlayer, (seasons) => {
        const profiles = buildPlayerProfiles(seasons)

        // With the same name in every season, they should cluster into one profile
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        // Compute expected totals by summing all skater entries across seasons
        const expected = { gp: 0, g: 0, a: 0, pts: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, pim: 0 }
        for (const season of seasons) {
          for (const skater of season.skaters) {
            expected.gp  += skater.gp  || 0
            expected.g   += skater.g   || 0
            expected.a   += skater.a   || 0
            expected.ppg += skater.ppg || 0
            expected.ppa += skater.ppa || 0
            expected.shg += skater.shg || 0
            expected.sha += skater.sha || 0
            expected.pim += skater.pim || 0
          }
        }
        // PTS SHALL equal G + A (recalculated, not summed from source)
        expected.pts = expected.g + expected.a

        expect(profile.totals.gp).toBe(expected.gp)
        expect(profile.totals.g).toBe(expected.g)
        expect(profile.totals.a).toBe(expected.a)
        expect(profile.totals.pts).toBe(expected.pts)
        expect(profile.totals.ppg).toBe(expected.ppg)
        expect(profile.totals.ppa).toBe(expected.ppa)
        expect(profile.totals.shg).toBe(expected.shg)
        expect(profile.totals.sha).toBe(expected.sha)
        expect(profile.totals.pim).toBe(expected.pim)
      }),
      { numRuns: 100 }
    )
  })

  it('PTS always equals G + A regardless of source pts values', () => {
    // Generate seasons where pts in source data is intentionally wrong
    const arbSkaterBadPts = fc.record({
      name: fc.constant('Doe, Jane'),
      number: fc.constant('7'),
      gp: arbStat,
      g: arbStat,
      a: arbStat,
      pts: fc.integer({ min: 500, max: 999 }), // deliberately incorrect pts
      ppg: arbStat,
      ppa: arbStat,
      shg: arbStat,
      sha: arbStat,
      pim: arbStat,
    })

    const arbSeasonsWithBadPts = fc.array(
      arbSkaterBadPts.map((skater, i) => ({
        seasonName: `Season ${i}`,
        seasonId: `s${i}`,
        skaters: [skater],
      })),
      { minLength: 1, maxLength: 8 }
    ).map(seasons => seasons.map((s, i) => ({ ...s, seasonName: `Season ${i}`, seasonId: `s${i}` })))

    fc.assert(
      fc.property(arbSeasonsWithBadPts, (seasons) => {
        const profiles = buildPlayerProfiles(seasons)
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        // PTS must always equal G + A, never the raw source pts
        expect(profile.totals.pts).toBe(profile.totals.g + profile.totals.a)
      }),
      { numRuns: 100 }
    )
  })

  it('career totals are correct with multiple seasons and varying stats', () => {
    // Use a broader generator: multiple seasons with unique seasonIds
    const arbMultiSeasonPlayer = fc.array(
      fc.record({
        gp: arbStat,
        g: arbStat,
        a: arbStat,
        pts: arbStat,
        ppg: arbStat,
        ppa: arbStat,
        shg: arbStat,
        sha: arbStat,
        pim: arbStat,
      }),
      { minLength: 2, maxLength: 15 }
    ).map(statEntries =>
      statEntries.map((stats, i) => ({
        seasonName: `Season ${i}`,
        seasonId: `sid_${i}`,
        skaters: [{ name: 'Johnson, Alex', number: '22', ...stats }],
      }))
    )

    fc.assert(
      fc.property(arbMultiSeasonPlayer, (seasons) => {
        const profiles = buildPlayerProfiles(seasons)
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        // Sum all individual season entries
        let totalGp = 0, totalG = 0, totalA = 0
        let totalPpg = 0, totalPpa = 0, totalShg = 0, totalSha = 0, totalPim = 0
        for (const season of seasons) {
          for (const s of season.skaters) {
            totalGp  += s.gp  || 0
            totalG   += s.g   || 0
            totalA   += s.a   || 0
            totalPpg += s.ppg || 0
            totalPpa += s.ppa || 0
            totalShg += s.shg || 0
            totalSha += s.sha || 0
            totalPim += s.pim || 0
          }
        }

        expect(profile.totals.gp).toBe(totalGp)
        expect(profile.totals.g).toBe(totalG)
        expect(profile.totals.a).toBe(totalA)
        expect(profile.totals.pts).toBe(totalG + totalA)
        expect(profile.totals.ppg).toBe(totalPpg)
        expect(profile.totals.ppa).toBe(totalPpa)
        expect(profile.totals.shg).toBe(totalShg)
        expect(profile.totals.sha).toBe(totalSha)
        expect(profile.totals.pim).toBe(totalPim)
      }),
      { numRuns: 100 }
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 7: Search index contains all entities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.8**
 *
 * Property 7: Search index contains all entities
 *
 * For any set of resolved player profiles and team entries produced by the
 * aggregation, every player display name and every team name SHALL appear in
 * the search index with a corresponding ID and normalized name field.
 */

// --- Search Index Generators ---

/** Generate a non-empty player/goalie display name (at least one alpha char). */
const arbDisplayName = fc.stringMatching(/^[A-Za-z][A-Za-z ',.-]{0,29}$/)

/** Generate a non-empty ID string. */
const arbId = fc.stringMatching(/^[a-f0-9]{4,16}$/)

/** Generate a player entry with { id, displayName }. */
const arbPlayer = fc.record({
  id: arbId,
  displayName: arbDisplayName
})

/** Generate a team entry with { teamId, teamName }. */
const arbTeam = fc.record({
  teamId: arbId,
  teamName: arbDisplayName
})

describe('Property 7: Search index contains all entities', () => {
  it('every player display name appears in the search index with correct fields', () => {
    fc.assert(
      fc.property(
        fc.array(arbPlayer, { minLength: 0, maxLength: 20 }),
        fc.array(arbPlayer, { minLength: 0, maxLength: 10 }),
        fc.array(arbTeam, { minLength: 0, maxLength: 15 }),
        (players, goalies, teams) => {
          const index = buildSearchIndex(players, goalies, teams)

          // Deduplicate players + goalies by ID (same logic as buildSearchIndex)
          const seenPlayerIds = new Set()
          const expectedPlayers = []
          for (const p of [...players, ...goalies]) {
            if (!p.id || !p.displayName) continue
            if (seenPlayerIds.has(p.id)) continue
            seenPlayerIds.add(p.id)
            expectedPlayers.push(p)
          }

          // Every expected player should appear in the index
          expect(index.players.length).toBe(expectedPlayers.length)

          for (const expected of expectedPlayers) {
            const found = index.players.find(entry => entry.id === expected.id)
            expect(found).toBeDefined()
            expect(found.name).toBe(expected.displayName)
            expect(found.normalized).toBe(normalizeName(expected.displayName))
            expect(found.type).toBe('player')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('every team name appears in the search index with correct fields', () => {
    fc.assert(
      fc.property(
        fc.array(arbPlayer, { minLength: 0, maxLength: 10 }),
        fc.array(arbPlayer, { minLength: 0, maxLength: 5 }),
        fc.array(arbTeam, { minLength: 0, maxLength: 20 }),
        (players, goalies, teams) => {
          const index = buildSearchIndex(players, goalies, teams)

          // Deduplicate teams by teamId (same logic as buildSearchIndex)
          const seenTeamIds = new Set()
          const expectedTeams = []
          for (const t of teams) {
            const teamId = t.teamId || t.id
            const teamName = t.teamName || t.name
            if (!teamId || !teamName) continue
            if (seenTeamIds.has(teamId)) continue
            seenTeamIds.add(teamId)
            expectedTeams.push({ id: teamId, name: teamName })
          }

          // Every expected team should appear in the index
          expect(index.teams.length).toBe(expectedTeams.length)

          for (const expected of expectedTeams) {
            const found = index.teams.find(entry => entry.id === expected.id)
            expect(found).toBeDefined()
            expect(found.name).toBe(expected.name)
            expect(found.normalized).toBe(normalizeName(expected.name))
            expect(found.type).toBe('team')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('search index contains both players and teams simultaneously', () => {
    fc.assert(
      fc.property(
        fc.array(arbPlayer, { minLength: 1, maxLength: 15 }),
        fc.array(arbPlayer, { minLength: 1, maxLength: 8 }),
        fc.array(arbTeam, { minLength: 1, maxLength: 12 }),
        (players, goalies, teams) => {
          const index = buildSearchIndex(players, goalies, teams)

          // Index must have both players and teams arrays
          expect(Array.isArray(index.players)).toBe(true)
          expect(Array.isArray(index.teams)).toBe(true)

          // At least some entries should exist (inputs have minLength: 1)
          expect(index.players.length + index.teams.length).toBeGreaterThan(0)

          // All entries have the required fields
          for (const entry of index.players) {
            expect(entry).toHaveProperty('id')
            expect(entry).toHaveProperty('name')
            expect(entry).toHaveProperty('normalized')
            expect(entry).toHaveProperty('type')
            expect(entry.type).toBe('player')
          }

          for (const entry of index.teams) {
            expect(entry).toHaveProperty('id')
            expect(entry).toHaveProperty('name')
            expect(entry).toHaveProperty('normalized')
            expect(entry).toHaveProperty('type')
            expect(entry.type).toBe('team')
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 3: Goalie career totals equal sum of season stats
// ─────────────────────────────────────────────────────────────────────────────

import { buildGoalieProfiles } from '../../src/utils/playerIdentity.mjs'

/**
 * **Validates: Requirements 3.3**
 *
 * Property 3: Goalie career totals equal sum of season stats
 *
 * For any set of goalie roster entries attributed to a single resolved goalie
 * across multiple seasons, the goalie's career totals (GP, W, L, T, GA, SA, SV, SO)
 * SHALL equal the sum of the corresponding fields from each season entry,
 * GAA SHALL equal GA/GP, and SV% SHALL equal SV/SA.
 */

// --- Goalie Generators ---

// Use a fixed goalie name so all entries cluster together into one profile
const FIXED_GOALIE_NAME = 'Johnson, Mike'

// Arbitrary goalie stat line for a single season
const goalieStatArb = fc.record({
  gp: fc.integer({ min: 1, max: 50 }),
  w: fc.integer({ min: 0, max: 50 }),
  l: fc.integer({ min: 0, max: 50 }),
  t: fc.integer({ min: 0, max: 20 }),
  ga: fc.integer({ min: 0, max: 200 }),
  sa: fc.integer({ min: 1, max: 2000 }),
  sv: fc.integer({ min: 0, max: 2000 }),
  so: fc.integer({ min: 0, max: 20 }),
  pim: fc.integer({ min: 0, max: 100 })
})

// A season entry with a single goalie using the fixed name
const goalieSeasonArb = fc.tuple(
  fc.integer({ min: 1, max: 200 }),     // season index for unique seasonId
  goalieStatArb
).map(([idx, stats]) => ({
  seasonName: `Season ${idx}`,
  seasonId: `s${idx}`,
  goalies: [{
    name: FIXED_GOALIE_NAME,
    number: '30',
    ...stats,
    gaa: stats.gp > 0 ? (stats.ga / stats.gp).toFixed(2) : '0.00',
    svpct: stats.sa > 0 ? (stats.sv / stats.sa).toFixed(3) : '0.000'
  }]
}))

// Array of seasons with the same goalie (so they all cluster)
const goalieProfileInputArb = fc.array(goalieSeasonArb, { minLength: 1, maxLength: 10 })
  // Ensure unique seasonIds to avoid deduplication
  .map(seasons => {
    const seen = new Set()
    return seasons.filter(s => {
      if (seen.has(s.seasonId)) return false
      seen.add(s.seasonId)
      return true
    })
  })
  .filter(seasons => seasons.length >= 1)

describe('Property 3: Goalie career totals equal sum of season stats', () => {
  it('career counting stats (GP, W, L, T, GA, SA, SV, SO) equal sum of all season entries', () => {
    fc.assert(
      fc.property(goalieProfileInputArb, (seasons) => {
        const profiles = buildGoalieProfiles(seasons)

        // With a single fixed name, we should get exactly one profile
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        // Compute expected sums from all input season entries
        const expectedGp = seasons.reduce((sum, s) => sum + s.goalies[0].gp, 0)
        const expectedW = seasons.reduce((sum, s) => sum + s.goalies[0].w, 0)
        const expectedL = seasons.reduce((sum, s) => sum + s.goalies[0].l, 0)
        const expectedT = seasons.reduce((sum, s) => sum + s.goalies[0].t, 0)
        const expectedGa = seasons.reduce((sum, s) => sum + s.goalies[0].ga, 0)
        const expectedSa = seasons.reduce((sum, s) => sum + s.goalies[0].sa, 0)
        const expectedSv = seasons.reduce((sum, s) => sum + s.goalies[0].sv, 0)
        const expectedSo = seasons.reduce((sum, s) => sum + s.goalies[0].so, 0)

        expect(profile.totals.gp).toBe(expectedGp)
        expect(profile.totals.w).toBe(expectedW)
        expect(profile.totals.l).toBe(expectedL)
        expect(profile.totals.t).toBe(expectedT)
        expect(profile.totals.ga).toBe(expectedGa)
        expect(profile.totals.sa).toBe(expectedSa)
        expect(profile.totals.sv).toBe(expectedSv)
        expect(profile.totals.so).toBe(expectedSo)
      }),
      { numRuns: 100 }
    )
  })

  it('GAA equals GA / GP for the career totals', () => {
    fc.assert(
      fc.property(goalieProfileInputArb, (seasons) => {
        const profiles = buildGoalieProfiles(seasons)
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        const totalGa = seasons.reduce((sum, s) => sum + s.goalies[0].ga, 0)
        const totalGp = seasons.reduce((sum, s) => sum + s.goalies[0].gp, 0)

        if (totalGp > 0) {
          const expectedGaa = (totalGa / totalGp).toFixed(2)
          expect(profile.totals.gaa).toBe(expectedGaa)
        } else {
          expect(profile.totals.gaa).toBe('—')
        }
      }),
      { numRuns: 100 }
    )
  })

  it('SV% equals SV / SA for the career totals', () => {
    fc.assert(
      fc.property(goalieProfileInputArb, (seasons) => {
        const profiles = buildGoalieProfiles(seasons)
        expect(profiles.length).toBe(1)
        const profile = profiles[0]

        const totalSv = seasons.reduce((sum, s) => sum + s.goalies[0].sv, 0)
        const totalSa = seasons.reduce((sum, s) => sum + s.goalies[0].sa, 0)

        if (totalSa > 0) {
          const expectedSvpct = (totalSv / totalSa).toFixed(3)
          expect(profile.totals.svpct).toBe(expectedSvpct)
        } else {
          expect(profile.totals.svpct).toBe('—')
        }
      }),
      { numRuns: 100 }
    )
  })

  it('works with multiple distinct goalies across seasons (no cross-contamination)', () => {
    // Generate seasons with two distinct goalies with very different names
    const twoGoalieSeasonArb = fc.tuple(
      fc.integer({ min: 1, max: 200 }),
      goalieStatArb,
      goalieStatArb
    ).map(([idx, stats1, stats2]) => ({
      seasonName: `Season ${idx}`,
      seasonId: `s${idx}`,
      goalies: [
        {
          name: 'Aaronson, Zack',
          number: '1',
          ...stats1,
          gaa: stats1.gp > 0 ? (stats1.ga / stats1.gp).toFixed(2) : '0.00',
          svpct: stats1.sa > 0 ? (stats1.sv / stats1.sa).toFixed(3) : '0.000'
        },
        {
          name: 'Zimmerman, Will',
          number: '99',
          ...stats2,
          gaa: stats2.gp > 0 ? (stats2.ga / stats2.gp).toFixed(2) : '0.00',
          svpct: stats2.sa > 0 ? (stats2.sv / stats2.sa).toFixed(3) : '0.000'
        }
      ]
    }))

    const multiGoalieInputArb = fc.array(twoGoalieSeasonArb, { minLength: 1, maxLength: 8 })
      .map(seasons => {
        const seen = new Set()
        return seasons.filter(s => {
          if (seen.has(s.seasonId)) return false
          seen.add(s.seasonId)
          return true
        })
      })
      .filter(seasons => seasons.length >= 1)

    fc.assert(
      fc.property(multiGoalieInputArb, (seasons) => {
        const profiles = buildGoalieProfiles(seasons)

        // Should get exactly 2 profiles (names are too different to cluster)
        expect(profiles.length).toBe(2)

        // Each profile's totals should match only their own entries
        for (const profile of profiles) {
          const isAaronson = normalizeName(profile.displayName).includes('aaronson')
          const goalieIdx = isAaronson ? 0 : 1

          const expectedGp = seasons.reduce((sum, s) => sum + s.goalies[goalieIdx].gp, 0)
          const expectedW = seasons.reduce((sum, s) => sum + s.goalies[goalieIdx].w, 0)
          const expectedGa = seasons.reduce((sum, s) => sum + s.goalies[goalieIdx].ga, 0)
          const expectedSa = seasons.reduce((sum, s) => sum + s.goalies[goalieIdx].sa, 0)
          const expectedSv = seasons.reduce((sum, s) => sum + s.goalies[goalieIdx].sv, 0)

          expect(profile.totals.gp).toBe(expectedGp)
          expect(profile.totals.w).toBe(expectedW)
          expect(profile.totals.ga).toBe(expectedGa)
          expect(profile.totals.sa).toBe(expectedSa)
          expect(profile.totals.sv).toBe(expectedSv)
        }
      }),
      { numRuns: 100 }
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 4: Leaders are sorted descending and bounded
// ─────────────────────────────────────────────────────────────────────────────

import { buildLeaders } from '../../scripts/aggregate/leaders.mjs'

/**
 * **Validates: Requirements 3.5**
 *
 * Property 4: Leaders are sorted descending and bounded
 *
 * For any set of player profiles, each leaderboard category (goals, assists,
 * points, PIM, wins, shutouts) SHALL be sorted in strictly non-increasing order
 * by the stat value, and SHALL contain at most 100 entries.
 */

// --- Leaders Generators ---

/** Generate a unique player ID (hex-like string) */
const leaderPlayerIdArb = fc.integer({ min: 1, max: 100000 }).map(n => `p${n.toString(16)}`)

/** Generate a display name for leader entries */
const leaderDisplayNameArb = fc.tuple(
  fc.stringMatching(/^[A-Z][a-z]{2,10}$/),
  fc.stringMatching(/^[A-Z][a-z]{2,10}$/)
).map(([last, first]) => `${last}, ${first}`)

/** Generate a skater player entry with totals suitable for leaders */
const leaderPlayerArb = fc.record({
  id: leaderPlayerIdArb,
  displayName: leaderDisplayNameArb,
  totals: fc.record({
    g: fc.integer({ min: 0, max: 500 }),
    a: fc.integer({ min: 0, max: 500 }),
    pts: fc.integer({ min: 0, max: 1000 }),
    pim: fc.integer({ min: 0, max: 2000 }),
    gp: fc.integer({ min: 1, max: 300 }),
    ppg: fc.integer({ min: 0, max: 200 }),
    ppa: fc.integer({ min: 0, max: 200 }),
    shg: fc.integer({ min: 0, max: 50 }),
    sha: fc.integer({ min: 0, max: 50 })
  })
})

/** Generate a goalie entry with totals suitable for leaders */
const leaderGoalieArb = fc.record({
  id: leaderPlayerIdArb,
  displayName: leaderDisplayNameArb,
  totals: fc.record({
    w: fc.integer({ min: 0, max: 300 }),
    so: fc.integer({ min: 0, max: 100 }),
    gp: fc.integer({ min: 1, max: 300 }),
    l: fc.integer({ min: 0, max: 200 }),
    t: fc.integer({ min: 0, max: 100 }),
    ga: fc.integer({ min: 0, max: 1000 }),
    sa: fc.integer({ min: 0, max: 5000 }),
    sv: fc.integer({ min: 0, max: 5000 })
  })
})

/** Generate arrays of players (0 to 150, to test bounding above 100) */
const leaderPlayersArb = fc.array(leaderPlayerArb, { minLength: 0, maxLength: 150 })

/** Generate arrays of goalies (0 to 150, to test bounding above 100) */
const leaderGoaliesArb = fc.array(leaderGoalieArb, { minLength: 0, maxLength: 150 })

/**
 * Helper: checks that an array of leader entries is sorted non-increasing by value
 */
function isSortedDescending(entries) {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].value > entries[i - 1].value) return false
  }
  return true
}

describe('Property 4: Leaders are sorted descending and bounded', () => {
  it('each skater leaderboard category is sorted non-increasing by value', () => {
    fc.assert(
      fc.property(leaderPlayersArb, leaderGoaliesArb, (players, goalies) => {
        const leaders = buildLeaders(players, goalies)

        expect(isSortedDescending(leaders.goals)).toBe(true)
        expect(isSortedDescending(leaders.assists)).toBe(true)
        expect(isSortedDescending(leaders.points)).toBe(true)
        expect(isSortedDescending(leaders.pim)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('each goalie leaderboard category is sorted non-increasing by value', () => {
    fc.assert(
      fc.property(leaderPlayersArb, leaderGoaliesArb, (players, goalies) => {
        const leaders = buildLeaders(players, goalies)

        expect(isSortedDescending(leaders.wins)).toBe(true)
        expect(isSortedDescending(leaders.shutouts)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('each leaderboard category contains at most 100 entries', () => {
    fc.assert(
      fc.property(leaderPlayersArb, leaderGoaliesArb, (players, goalies) => {
        const leaders = buildLeaders(players, goalies)

        expect(leaders.goals.length).toBeLessThanOrEqual(100)
        expect(leaders.assists.length).toBeLessThanOrEqual(100)
        expect(leaders.points.length).toBeLessThanOrEqual(100)
        expect(leaders.pim.length).toBeLessThanOrEqual(100)
        expect(leaders.wins.length).toBeLessThanOrEqual(100)
        expect(leaders.shutouts.length).toBeLessThanOrEqual(100)
      }),
      { numRuns: 100 }
    )
  })

  it('leaderboards are correctly bounded when input exceeds 100 entries', () => {
    // Use a generator that always produces more than 100 players/goalies
    const manyPlayersArb = fc.array(leaderPlayerArb, { minLength: 101, maxLength: 150 })
    const manyGoaliesArb = fc.array(leaderGoalieArb, { minLength: 101, maxLength: 150 })

    fc.assert(
      fc.property(manyPlayersArb, manyGoaliesArb, (players, goalies) => {
        const leaders = buildLeaders(players, goalies)

        // With >100 inputs, each category should be capped at exactly 100
        expect(leaders.goals.length).toBe(100)
        expect(leaders.assists.length).toBe(100)
        expect(leaders.points.length).toBe(100)
        expect(leaders.pim.length).toBe(100)
        expect(leaders.wins.length).toBe(100)
        expect(leaders.shutouts.length).toBe(100)

        // Still sorted
        expect(isSortedDescending(leaders.goals)).toBe(true)
        expect(isSortedDescending(leaders.assists)).toBe(true)
        expect(isSortedDescending(leaders.points)).toBe(true)
        expect(isSortedDescending(leaders.pim)).toBe(true)
        expect(isSortedDescending(leaders.wins)).toBe(true)
        expect(isSortedDescending(leaders.shutouts)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 5: Head-to-head record matches game outcomes
// ─────────────────────────────────────────────────────────────────────────────

import { computeMatchupFromGames } from '../../scripts/aggregate/headToHead.mjs'

/**
 * **Validates: Requirements 3.6, 8.2**
 *
 * Property 5: Head-to-head record matches game outcomes
 *
 * For any set of completed games between two teams, the head-to-head record
 * SHALL report wins for team1 equal to the count of games where team1's final
 * score exceeds team2's, wins for team2 equal to the count of the inverse,
 * ties equal to the count of equal final scores, and the game list SHALL be
 * sorted by date descending.
 */

// --- Head-to-Head Generators ---

// Two fixed team IDs where team1 < team2 (lexicographic sort)
const TEAM1_ID = 'team_aaa'
const TEAM2_ID = 'team_bbb'

// Arbitrary game score (non-negative integers)
const scoreArb = fc.integer({ min: 0, max: 20 })

// Arbitrary date string in ISO format (YYYY-MM-DD) for sortable dates
const dateArb = fc.tuple(
  fc.integer({ min: 2008, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

// A single game between the two fixed teams (home/away assignment is random)
const gameArb = fc.record({
  homeIsTeam1: fc.boolean(),
  homeScore: scoreArb,
  awayScore: scoreArb,
  date: dateArb,
  gameId: fc.integer({ min: 1000, max: 99999 }).map(String),
  seasonName: fc.constantFrom('Winter 2018', 'Summer 2019', 'Fall 2020', 'Spring 2021'),
  divId: fc.integer({ min: 100, max: 300 }).map(String)
}).map(({ homeIsTeam1, homeScore, awayScore, date, gameId, seasonName, divId }) => ({
  homeTeamId: homeIsTeam1 ? TEAM1_ID : TEAM2_ID,
  awayTeamId: homeIsTeam1 ? TEAM2_ID : TEAM1_ID,
  homeScore,
  awayScore,
  date,
  gameId,
  seasonName,
  divId
}))

// An array of games between the two fixed teams (1 to 50 games)
// Uses uniqueArray on gameId to avoid duplicate gameId collisions in the find-by-id test
const gamesArb = fc.uniqueArray(gameArb, { minLength: 1, maxLength: 50, selector: g => g.gameId })

describe('Property 5: Head-to-head record matches game outcomes', () => {
  it('team1 wins equal count of games where team1 score exceeds team2 score', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // Count expected team1 wins: games where team1's final score > team2's final score
        const expectedTeam1Wins = games.filter(g => {
          const team1Score = g.homeTeamId === TEAM1_ID ? g.homeScore : g.awayScore
          const team2Score = g.homeTeamId === TEAM2_ID ? g.homeScore : g.awayScore
          return team1Score > team2Score
        }).length

        expect(result.team1.wins).toBe(expectedTeam1Wins)
      }),
      { numRuns: 100 }
    )
  })

  it('team2 wins equal count of games where team2 score exceeds team1 score', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // Count expected team2 wins: games where team2's final score > team1's final score
        const expectedTeam2Wins = games.filter(g => {
          const team1Score = g.homeTeamId === TEAM1_ID ? g.homeScore : g.awayScore
          const team2Score = g.homeTeamId === TEAM2_ID ? g.homeScore : g.awayScore
          return team2Score > team1Score
        }).length

        expect(result.team2.wins).toBe(expectedTeam2Wins)
      }),
      { numRuns: 100 }
    )
  })

  it('ties equal count of games where both teams have equal final scores', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // Count expected ties: games where scores are equal
        const expectedTies = games.filter(g => g.homeScore === g.awayScore).length

        expect(result.ties).toBe(expectedTies)
      }),
      { numRuns: 100 }
    )
  })

  it('total wins + ties equals the number of games', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // W1 + W2 + ties must equal total number of games
        expect(result.team1.wins + result.team2.wins + result.ties).toBe(games.length)
      }),
      { numRuns: 100 }
    )
  })

  it('game list is sorted by date descending (most recent first)', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // Verify games are sorted by date descending
        for (let i = 1; i < result.games.length; i++) {
          const prevDate = result.games[i - 1].date
          const currDate = result.games[i].date
          // prevDate >= currDate (descending order)
          expect(prevDate >= currDate).toBe(true)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('game list contains all input games with correct scores', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // Same number of games in output as input
        expect(result.games.length).toBe(games.length)

        // Every input game should appear in the output (match by gameId)
        for (const inputGame of games) {
          const found = result.games.find(g => g.gameId === inputGame.gameId)
          expect(found).toBeDefined()
          expect(found.score.home).toBe(inputGame.homeScore)
          expect(found.score.away).toBe(inputGame.awayScore)
          expect(found.homeTeamId).toBe(inputGame.homeTeamId)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('team1 always has the lexicographically smaller teamId', () => {
    fc.assert(
      fc.property(gamesArb, (games) => {
        const result = computeMatchupFromGames(games)

        // team1.teamId < team2.teamId (lexicographic)
        expect(result.team1.teamId < result.team2.teamId).toBe(true)
        expect(result.team1.teamId).toBe(TEAM1_ID)
        expect(result.team2.teamId).toBe(TEAM2_ID)
      }),
      { numRuns: 100 }
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: fairfax-archive-site, Property 6: Team season record matches roster/schedule data
// ─────────────────────────────────────────────────────────────────────────────

import { buildTeamIndexFromData } from '../../scripts/aggregate/teamIndex.mjs'

/**
 * **Validates: Requirements 3.7**
 *
 * Property 6: Team season record matches roster/schedule data
 *
 * For any team appearing in the archive, the team detail JSON SHALL contain one
 * entry per season-division the team participated in, and the record (W, L, T) for
 * each season SHALL be consistent with that team's game outcomes in the schedule
 * data for that division.
 */

// --- Generators for Property 6 ---

/** Arbitrary team ID (numeric string) */
const arbTeamId = fc.integer({ min: 1, max: 9999 }).map(String)

/** Arbitrary team name */
const arbTeamName = fc.stringMatching(/^[A-Za-z ]{2,15}$/).filter(s => s.trim().length > 0)

/**
 * Generate a division with teams, a schedule of games between those teams, and
 * corresponding game scores. Returns { division, gameScoreEntries } where division
 * matches the format buildTeamIndexFromData expects.
 */
const arbDivisionWithGames = fc.integer({ min: 2, max: 6 }).chain(numTeams => {
  // Generate numTeams unique team IDs and names
  return fc.tuple(
    fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: numTeams, maxLength: numTeams }),
    fc.array(arbTeamName, { minLength: numTeams, maxLength: numTeams })
  ).chain(([teamIds, teamNames]) => {
    const teamIdStrs = teamIds.map(String)
    const teams = {}
    for (let i = 0; i < numTeams; i++) {
      teams[teamIdStrs[i]] = teamNames[i]
    }

    // Generate matchups: each pair of teams plays 0-2 games
    const matchups = []
    for (let i = 0; i < teamIdStrs.length; i++) {
      for (let j = i + 1; j < teamIdStrs.length; j++) {
        matchups.push([teamIdStrs[i], teamIdStrs[j]])
      }
    }

    // For each matchup, generate 0-2 games
    const gameCountArb = fc.array(
      fc.integer({ min: 0, max: 2 }),
      { minLength: matchups.length, maxLength: matchups.length }
    )

    return gameCountArb.chain(gameCounts => {
      // Build the list of games to generate scores for
      const gameSpecs = []
      let gameIdCounter = 1000
      for (let m = 0; m < matchups.length; m++) {
        for (let g = 0; g < gameCounts[m]; g++) {
          gameSpecs.push({
            gameId: String(gameIdCounter++),
            homeTeamId: matchups[m][0],
            awayTeamId: matchups[m][1]
          })
        }
      }

      if (gameSpecs.length === 0) {
        // No games — return division with empty schedule
        return fc.constant({
          division: {
            meta: { divId: '100', seasonName: 'Winter 2020', divisionLabel: 'A', teams },
            schedule: { records: [] },
            roster: null,
            divId: '100'
          },
          gameScoreEntries: []
        })
      }

      // Generate scores for each game
      const scoresArb = fc.array(
        fc.tuple(fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 })),
        { minLength: gameSpecs.length, maxLength: gameSpecs.length }
      )

      return scoresArb.map(scores => {
        const scheduleRecords = gameSpecs.map((spec, idx) => ({
          gameId: spec.gameId,
          home: { teamId: spec.homeTeamId, name: teams[spec.homeTeamId] },
          away: { teamId: spec.awayTeamId, name: teams[spec.awayTeamId] },
          date: '2020-01-15'
        }))

        const gameScoreEntries = gameSpecs.map((spec, idx) => ({
          gameId: spec.gameId,
          homeTeamId: spec.homeTeamId,
          awayTeamId: spec.awayTeamId,
          homeScore: scores[idx][0],
          awayScore: scores[idx][1]
        }))

        return {
          division: {
            meta: { divId: '100', seasonName: 'Winter 2020', divisionLabel: 'A', teams },
            schedule: { records: scheduleRecords },
            roster: null,
            divId: '100'
          },
          gameScoreEntries
        }
      })
    })
  })
})

/**
 * Generate multiple divisions, each with their own teams and games.
 * Divisions may share some team IDs (simulating a team across seasons).
 */
const arbMultipleDivisions = fc.array(
  fc.tuple(
    fc.integer({ min: 100, max: 999 }),  // divId
    seasonNameArb,                        // seasonName
    divisionLabelArb,                     // divisionLabel
    fc.integer({ min: 2, max: 5 })       // numTeams
  ).chain(([divIdNum, seasonName, divisionLabel, numTeams]) => {
    const divId = String(divIdNum)
    return fc.tuple(
      fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: numTeams, maxLength: numTeams }),
      fc.array(arbTeamName, { minLength: numTeams, maxLength: numTeams })
    ).chain(([teamIds, teamNames]) => {
      const teamIdStrs = teamIds.map(String)
      const teams = {}
      for (let i = 0; i < numTeams; i++) {
        teams[teamIdStrs[i]] = teamNames[i]
      }

      // Generate games between team pairs
      const matchups = []
      for (let i = 0; i < teamIdStrs.length; i++) {
        for (let j = i + 1; j < teamIdStrs.length; j++) {
          matchups.push([teamIdStrs[i], teamIdStrs[j]])
        }
      }

      // Each matchup has 0 or 1 game (keep it small)
      return fc.array(
        fc.boolean(),
        { minLength: matchups.length, maxLength: matchups.length }
      ).chain(hasGame => {
        const gameSpecs = []
        let gameIdBase = divIdNum * 100
        for (let m = 0; m < matchups.length; m++) {
          if (hasGame[m]) {
            gameSpecs.push({
              gameId: String(gameIdBase++),
              homeTeamId: matchups[m][0],
              awayTeamId: matchups[m][1]
            })
          }
        }

        if (gameSpecs.length === 0) {
          return fc.constant({
            division: {
              meta: { divId, seasonName, divisionLabel, teams },
              schedule: { records: [] },
              roster: null,
              divId
            },
            gameScoreEntries: []
          })
        }

        return fc.array(
          fc.tuple(fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 })),
          { minLength: gameSpecs.length, maxLength: gameSpecs.length }
        ).map(scores => {
          const scheduleRecords = gameSpecs.map((spec, idx) => ({
            gameId: spec.gameId,
            home: { teamId: spec.homeTeamId, name: teams[spec.homeTeamId] },
            away: { teamId: spec.awayTeamId, name: teams[spec.awayTeamId] },
            date: '2020-01-15'
          }))

          const gameScoreEntries = gameSpecs.map((spec, idx) => ({
            gameId: spec.gameId,
            homeTeamId: spec.homeTeamId,
            awayTeamId: spec.awayTeamId,
            homeScore: scores[idx][0],
            awayScore: scores[idx][1]
          }))

          return {
            division: {
              meta: { divId, seasonName, divisionLabel, teams },
              schedule: { records: scheduleRecords },
              roster: null,
              divId
            },
            gameScoreEntries
          }
        })
      })
    })
  }),
  { minLength: 1, maxLength: 5 }
)

describe('Property 6: Team season record matches roster/schedule data', () => {
  it('each team has one season entry per division it participates in', () => {
    fc.assert(
      fc.property(arbMultipleDivisions, (divsWithGames) => {
        const divisions = divsWithGames.map(d => d.division)
        const gameScores = new Map()
        for (const d of divsWithGames) {
          for (const entry of d.gameScoreEntries) {
            gameScores.set(entry.gameId, entry)
          }
        }

        const teamIndex = buildTeamIndexFromData(divisions, gameScores)

        // For each team, count how many divisions they appear in
        const expectedSeasonsByTeam = new Map() // teamId → Set of divIds
        for (const div of divisions) {
          if (!div.meta.teams) continue
          for (const teamId of Object.keys(div.meta.teams)) {
            if (!expectedSeasonsByTeam.has(teamId)) {
              expectedSeasonsByTeam.set(teamId, new Set())
            }
            expectedSeasonsByTeam.get(teamId).add(div.meta.divId)
          }
        }

        // Verify each team has the correct number of season entries
        for (const [teamId, expectedDivIds] of expectedSeasonsByTeam) {
          const teamDetail = teamIndex[teamId]
          expect(teamDetail).toBeDefined()
          expect(teamDetail.seasons.length).toBe(expectedDivIds.size)

          // Verify each expected divId appears in the seasons
          const actualDivIds = new Set(teamDetail.seasons.map(s => s.divId))
          expect(actualDivIds).toEqual(expectedDivIds)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('team W/L/T record matches game outcomes in the schedule', () => {
    fc.assert(
      fc.property(arbDivisionWithGames, ({ division, gameScoreEntries }) => {
        const gameScores = new Map()
        for (const entry of gameScoreEntries) {
          gameScores.set(entry.gameId, entry)
        }

        const teamIndex = buildTeamIndexFromData([division], gameScores)

        // Compute expected W/L/T for each team from game outcomes
        const expectedRecords = new Map()
        for (const teamId of Object.keys(division.meta.teams)) {
          expectedRecords.set(teamId, { w: 0, l: 0, t: 0 })
        }

        for (const game of division.schedule.records) {
          const score = gameScores.get(String(game.gameId))
          if (!score) continue

          const homeId = String(game.home.teamId)
          const awayId = String(game.away.teamId)
          const homeRec = expectedRecords.get(homeId)
          const awayRec = expectedRecords.get(awayId)

          if (!homeRec || !awayRec) continue

          if (score.homeScore > score.awayScore) {
            homeRec.w++
            awayRec.l++
          } else if (score.awayScore > score.homeScore) {
            awayRec.w++
            homeRec.l++
          } else {
            homeRec.t++
            awayRec.t++
          }
        }

        // Verify each team's record matches
        for (const [teamId, expected] of expectedRecords) {
          const teamDetail = teamIndex[teamId]
          expect(teamDetail).toBeDefined()
          expect(teamDetail.seasons.length).toBe(1)

          const season = teamDetail.seasons[0]
          expect(season.record.w).toBe(expected.w)
          expect(season.record.l).toBe(expected.l)
          expect(season.record.t).toBe(expected.t)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('team W/L/T is consistent across multiple divisions', () => {
    fc.assert(
      fc.property(arbMultipleDivisions, (divsWithGames) => {
        const divisions = divsWithGames.map(d => d.division)
        const gameScores = new Map()
        for (const d of divsWithGames) {
          for (const entry of d.gameScoreEntries) {
            gameScores.set(entry.gameId, entry)
          }
        }

        const teamIndex = buildTeamIndexFromData(divisions, gameScores)

        // Compute expected W/L/T per team per division
        for (const div of divisions) {
          if (!div.meta.teams) continue

          const expectedRecords = new Map()
          for (const teamId of Object.keys(div.meta.teams)) {
            expectedRecords.set(teamId, { w: 0, l: 0, t: 0 })
          }

          if (div.schedule && div.schedule.records) {
            for (const game of div.schedule.records) {
              const score = gameScores.get(String(game.gameId))
              if (!score) continue

              const homeId = String(game.home.teamId)
              const awayId = String(game.away.teamId)
              const homeRec = expectedRecords.get(homeId)
              const awayRec = expectedRecords.get(awayId)

              if (!homeRec || !awayRec) continue

              if (score.homeScore > score.awayScore) {
                homeRec.w++
                awayRec.l++
              } else if (score.awayScore > score.homeScore) {
                awayRec.w++
                homeRec.l++
              } else {
                homeRec.t++
                awayRec.t++
              }
            }
          }

          // Verify each team's record for this specific division
          for (const [teamId, expected] of expectedRecords) {
            const teamDetail = teamIndex[teamId]
            expect(teamDetail).toBeDefined()

            const seasonEntry = teamDetail.seasons.find(s => s.divId === div.meta.divId)
            expect(seasonEntry).toBeDefined()
            expect(seasonEntry.record.w).toBe(expected.w)
            expect(seasonEntry.record.l).toBe(expected.l)
            expect(seasonEntry.record.t).toBe(expected.t)
          }
        }
      }),
      { numRuns: 100 }
    )
  })
})
