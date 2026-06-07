// Feature: fairfax-archive-site, Property 9: Suspension filter returns only matching entries
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { filterSuspensions } from '../../src/utils/suspensionFilters.mjs'

/**
 * **Validates: Requirements 10.5**
 *
 * Property 9: Suspension filter returns only matching entries
 *
 * For any combination of filter criteria (season, team, rule type) and suspension data,
 * the filtered result set SHALL contain only entries where every active filter criterion
 * matches the entry's corresponding field, and SHALL contain all entries from the source
 * that match all active criteria.
 */

// --- Generators ---

/** Arbitrary season name */
const seasonNameArb = fc.tuple(
  fc.constantFrom('Winter', 'Spring', 'Summer', 'Fall'),
  fc.integer({ min: 2008, max: 2030 })
).map(([term, year]) => `${term} ${year}`)

/** Arbitrary team name */
const teamNameArb = fc.stringMatching(/^[A-Za-z ]{3,20}$/).filter(s => s.trim().length >= 3)

/** Arbitrary rule type */
const ruleArb = fc.constantFrom(
  '20pim-7games',
  '25pim-1game',
  'match-penalty',
  'game-misconduct',
  'fighting-major',
  'abuse-of-officials'
)

/** Arbitrary team reference */
const teamRefArb = fc.record({
  teamId: fc.integer({ min: 1, max: 9999 }).map(String),
  name: teamNameArb
})

/** Arbitrary suspension entry */
const suspensionEntryArb = fc.record({
  playerKey: fc.stringMatching(/^[a-z]{3,10}-[a-z]{3,10}$/),
  playerName: fc.tuple(
    fc.stringMatching(/^[A-Z][a-z]{2,10}$/),
    fc.stringMatching(/^[A-Z][a-z]{2,10}$/)
  ).map(([last, first]) => `${last}, ${first}`),
  team: teamRefArb,
  divId: fc.integer({ min: 100, max: 999 }),
  seasonName: seasonNameArb,
  rule: ruleArb,
  appliesToGames: fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 7 }),
  corroboratedByRosterColumn: fc.boolean(),
  discrepancy: fc.boolean()
})

/** Arbitrary array of suspension entries */
const suspensionsArb = fc.array(suspensionEntryArb, { minLength: 0, maxLength: 30 })

/** Arbitrary filter object with optional keys drawn from the actual data values */
const filtersFromDataArb = (suspensions) => {
  // Collect all possible values from the data
  const seasons = [...new Set(suspensions.map(s => s.seasonName))]
  const teams = [...new Set(suspensions.map(s => s.team.name))]
  const rules = [...new Set(suspensions.map(s => s.rule))]

  return fc.record({
    season: seasons.length > 0
      ? fc.oneof(fc.constant(undefined), fc.constantFrom(...seasons))
      : fc.constant(undefined),
    team: teams.length > 0
      ? fc.oneof(fc.constant(undefined), fc.constantFrom(...teams))
      : fc.constant(undefined),
    rule: rules.length > 0
      ? fc.oneof(fc.constant(undefined), fc.constantFrom(...rules))
      : fc.constant(undefined)
  })
}

/** Arbitrary filter that may contain values not present in the data */
const arbitraryFiltersArb = fc.record({
  season: fc.oneof(fc.constant(undefined), seasonNameArb),
  team: fc.oneof(fc.constant(undefined), teamNameArb),
  rule: fc.oneof(fc.constant(undefined), ruleArb)
})

// --- Helper: reference implementation for verifying correctness ---
function referenceFilter(suspensions, filters) {
  if (!suspensions || !Array.isArray(suspensions)) return []
  if (!filters) return suspensions

  return suspensions.filter((entry) => {
    if (filters.season && entry.seasonName !== filters.season) return false
    if (filters.team && entry.team.name !== filters.team) return false
    if (filters.rule && entry.rule !== filters.rule) return false
    return true
  })
}

describe('Property 9: Suspension filter returns only matching entries', () => {
  it('filtered results contain only entries matching ALL active filter criteria', () => {
    fc.assert(
      fc.property(suspensionsArb, arbitraryFiltersArb, (suspensions, filters) => {
        const result = filterSuspensions(suspensions, filters)

        // Every entry in the result must match all active filter criteria
        for (const entry of result) {
          if (filters.season) {
            expect(entry.seasonName).toBe(filters.season)
          }
          if (filters.team) {
            expect(entry.team.name).toBe(filters.team)
          }
          if (filters.rule) {
            expect(entry.rule).toBe(filters.rule)
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('filtered results contain ALL entries from source that match all active criteria', () => {
    fc.assert(
      fc.property(suspensionsArb, arbitraryFiltersArb, (suspensions, filters) => {
        const result = filterSuspensions(suspensions, filters)

        // Find all entries that should match
        const expectedMatches = suspensions.filter((entry) => {
          if (filters.season && entry.seasonName !== filters.season) return false
          if (filters.team && entry.team.name !== filters.team) return false
          if (filters.rule && entry.rule !== filters.rule) return false
          return true
        })

        // Result must contain exactly all matching entries (same count)
        expect(result.length).toBe(expectedMatches.length)

        // Every expected match must appear in the result
        for (const expected of expectedMatches) {
          expect(result).toContain(expected)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('with filters drawn from existing data values, results are a correct subset', () => {
    fc.assert(
      fc.property(
        suspensionsArb.filter(s => s.length > 0),
        fc.anything(),
        (suspensions) => {
          // Generate filters from the actual data values
          return fc.assert(
            fc.property(filtersFromDataArb(suspensions), (filters) => {
              const result = filterSuspensions(suspensions, filters)
              const expected = referenceFilter(suspensions, filters)

              expect(result.length).toBe(expected.length)

              // Verify same entries in same order
              for (let i = 0; i < result.length; i++) {
                expect(result[i]).toBe(expected[i])
              }
            }),
            { numRuns: 20 }
          )
        }
      ),
      { numRuns: 5 }
    )
  })

  it('empty filter criteria returns all entries unchanged', () => {
    fc.assert(
      fc.property(suspensionsArb, (suspensions) => {
        // No active filters (all undefined)
        const filters = { season: undefined, team: undefined, rule: undefined }
        const result = filterSuspensions(suspensions, filters)

        expect(result.length).toBe(suspensions.length)
        for (let i = 0; i < result.length; i++) {
          expect(result[i]).toBe(suspensions[i])
        }
      }),
      { numRuns: 100 }
    )
  })

  it('result is always a subset of the original array (no fabricated entries)', () => {
    fc.assert(
      fc.property(suspensionsArb, arbitraryFiltersArb, (suspensions, filters) => {
        const result = filterSuspensions(suspensions, filters)

        // Every result entry must be a reference from the original array
        for (const entry of result) {
          expect(suspensions).toContain(entry)
        }

        // Result cannot be larger than input
        expect(result.length).toBeLessThanOrEqual(suspensions.length)
      }),
      { numRuns: 100 }
    )
  })

  it('single filter criterion correctly partitions the data', () => {
    fc.assert(
      fc.property(suspensionsArb.filter(s => s.length > 0), (suspensions) => {
        // Pick a season from the data
        const targetSeason = suspensions[0].seasonName
        const filters = { season: targetSeason }

        const result = filterSuspensions(suspensions, filters)

        // All results must have the target season
        for (const entry of result) {
          expect(entry.seasonName).toBe(targetSeason)
        }

        // All entries with the target season must be in the result
        const allWithSeason = suspensions.filter(e => e.seasonName === targetSeason)
        expect(result.length).toBe(allWithSeason.length)
      }),
      { numRuns: 100 }
    )
  })
})
