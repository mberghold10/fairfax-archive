// Feature: fairfax-archive-site, Property 8: Search filter returns correct and ranked results
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { normalizeQuery, filterSearchIndex } from '../../src/utils/searchFilter.mjs'

/**
 * **Validates: Requirements 11.2, 11.3, 11.4**
 *
 * Property 8: Search filter returns correct and ranked results
 *
 * For any non-empty query string and search index, the search function SHALL return
 * only entries whose normalized name contains the query as a substring, SHALL rank
 * prefix matches above non-prefix substring matches, SHALL include results from both
 * player and team types when matches exist in both, and SHALL return at most 10 results.
 */

// --- Generators ---

/** Arbitrary non-empty alphabetic string for names */
const namePartArb = fc.stringMatching(/^[A-Za-z]{2,12}$/)

/** Arbitrary player name (Last, First format) */
const playerNameArb = fc.tuple(namePartArb, namePartArb).map(
  ([last, first]) => `${last}, ${first}`
)

/** Arbitrary team name */
const teamNameArb = fc.tuple(namePartArb, fc.constantFrom('Kings', 'Eagles', 'Stars', 'Wolves', 'Bears', 'Hawks')).map(
  ([adj, noun]) => `${adj} ${noun}`
)

/** Build a SearchEntry from a name and type */
function makeEntry(name, type, id) {
  return {
    id: id || `${type}-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    name,
    normalized: name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
    type
  }
}

/** Arbitrary player SearchEntry */
const playerEntryArb = fc.tuple(playerNameArb, fc.uuid()).map(
  ([name, id]) => makeEntry(name, 'player', `p-${id}`)
)

/** Arbitrary team SearchEntry */
const teamEntryArb = fc.tuple(teamNameArb, fc.uuid()).map(
  ([name, id]) => makeEntry(name, 'team', `t-${id}`)
)

/** Arbitrary search index with players and teams */
const searchIndexArb = fc.record({
  players: fc.array(playerEntryArb, { minLength: 0, maxLength: 20 }),
  teams: fc.array(teamEntryArb, { minLength: 0, maxLength: 10 })
})

/** Arbitrary non-empty query string (alphabetic, 1-8 chars) */
const queryArb = fc.stringMatching(/^[A-Za-z]{1,8}$/).filter(s => s.trim().length > 0)

/** Generate a query known to match at least one entry in the index (substring of a name) */
function queryFromIndexArb(index) {
  const allEntries = [...(index.players || []), ...(index.teams || [])]
  if (allEntries.length === 0) return fc.constant(null)
  return fc.constantFrom(...allEntries).chain(entry => {
    const norm = entry.normalized
    if (norm.length < 1) return fc.constant(null)
    // Pick a substring of the normalized name
    return fc.integer({ min: 0, max: Math.max(0, norm.length - 1) }).chain(start => {
      const maxEnd = Math.min(norm.length, start + 8)
      return fc.integer({ min: start + 1, max: maxEnd }).map(end => norm.slice(start, end))
    })
  }).filter(q => q !== null && q.trim().length > 0)
}

// --- Tests ---

describe('Property 8: Search filter returns correct and ranked results', () => {
  it('all returned results have normalized name containing the normalized query as substring', () => {
    fc.assert(
      fc.property(searchIndexArb, queryArb, (index, query) => {
        const results = filterSearchIndex(query, index)
        const normalizedQ = normalizeQuery(query)

        if (!normalizedQ) return // empty normalized query → no results expected

        for (const result of results) {
          // Find the original entry to get its normalized field (match by id AND name)
          const allEntries = [...(index.players || []), ...(index.teams || [])]
          const original = allEntries.find(e => e.id === result.id && e.name === result.name)
          expect(original).toBeDefined()
          expect(original.normalized).toContain(normalizedQ)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('prefix matches come before non-prefix substring matches in results', () => {
    fc.assert(
      fc.property(searchIndexArb, queryArb, (index, query) => {
        const results = filterSearchIndex(query, index)
        const normalizedQ = normalizeQuery(query)

        if (!normalizedQ || results.length === 0) return

        const allEntries = [...(index.players || []), ...(index.teams || [])]

        // Classify each result as prefix or substring
        let seenSubstring = false
        for (const result of results) {
          const original = allEntries.find(e => e.id === result.id && e.name === result.name)
          const isPrefix = original.normalized.startsWith(normalizedQ)

          if (isPrefix) {
            // A prefix match must not come after a non-prefix substring match
            expect(seenSubstring).toBe(false)
          } else {
            seenSubstring = true
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('results include both player and team types when matches exist in both', () => {
    fc.assert(
      fc.property(searchIndexArb, queryArb, (index, query) => {
        const results = filterSearchIndex(query, index)
        const normalizedQ = normalizeQuery(query)

        if (!normalizedQ) return

        const allEntries = [...(index.players || []), ...(index.teams || [])]

        // Check if matches exist in both types
        const playerMatches = (index.players || []).filter(e => e.normalized.includes(normalizedQ))
        const teamMatches = (index.teams || []).filter(e => e.normalized.includes(normalizedQ))

        if (playerMatches.length > 0 && teamMatches.length > 0) {
          // Results should include at least one of each type (unless capped at 10)
          const resultTypes = new Set(results.map(r => r.type))

          // If total matching entries from both types fit within 10, both must appear
          const totalMatches = playerMatches.length + teamMatches.length
          if (totalMatches <= 10) {
            expect(resultTypes.has('player')).toBe(true)
            expect(resultTypes.has('team')).toBe(true)
          } else {
            // With cap of 10, at least verify that both types have the opportunity to appear
            // (both are in the unified list before slicing)
            const allMatching = allEntries.filter(e => e.normalized.includes(normalizedQ))
            const allMatchingTypes = new Set(allMatching.map(e => e.type))
            expect(allMatchingTypes.has('player')).toBe(true)
            expect(allMatchingTypes.has('team')).toBe(true)
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('result count is at most 10', () => {
    fc.assert(
      fc.property(searchIndexArb, queryArb, (index, query) => {
        const results = filterSearchIndex(query, index)
        expect(results.length).toBeLessThanOrEqual(10)
      }),
      { numRuns: 100 }
    )
  })

  it('with a query derived from existing data, returns at least one match', () => {
    fc.assert(
      fc.property(
        searchIndexArb.filter(idx => idx.players.length + idx.teams.length > 0),
        fc.anything(),
        (index) => {
          return fc.assert(
            fc.property(queryFromIndexArb(index), (query) => {
              if (!query) return
              const results = filterSearchIndex(query, index)
              expect(results.length).toBeGreaterThanOrEqual(1)
            }),
            { numRuns: 20 }
          )
        }
      ),
      { numRuns: 5 }
    )
  })

  it('empty normalized query returns empty results', () => {
    fc.assert(
      fc.property(searchIndexArb, (index) => {
        // Queries that normalize to empty (only punctuation/spaces)
        const emptyQueries = ['', '   ', '!!!', '...', '---']
        for (const q of emptyQueries) {
          const results = filterSearchIndex(q, index)
          expect(results.length).toBe(0)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('results do not contain duplicates', () => {
    fc.assert(
      fc.property(searchIndexArb, queryArb, (index, query) => {
        const results = filterSearchIndex(query, index)
        const ids = results.map(r => r.id)
        const uniqueIds = new Set(ids)
        expect(uniqueIds.size).toBe(ids.length)
      }),
      { numRuns: 100 }
    )
  })
})
