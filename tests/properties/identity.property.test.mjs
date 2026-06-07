// Feature: fairfax-archive-site, Property 10: Player identity clustering correctness
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { normalizeName, jaroWinkler, buildPlayerProfiles } from '../../src/utils/playerIdentity.mjs'

/**
 * **Validates: Requirements 14.4**
 *
 * Property 10: Player identity clustering correctness
 *
 * For any two player roster entries, if the Jaro-Winkler similarity of their
 * normalized names exceeds the threshold (0.88) with optional jersey number boost,
 * they SHALL be assigned to the same cluster. If the similarity is below the
 * threshold with no number boost, they SHALL remain in separate clusters.
 */

const SIMILARITY_THRESHOLD = 0.88
const JERSEY_NUMBER_BOOST = 0.05

// Generator for realistic player names (Last, First format)
const lowerAlphaArb = fc.stringMatching(/^[a-z]{3,10}$/)

const playerNameArb = fc.tuple(lowerAlphaArb, lowerAlphaArb).map(([last, first]) => {
  const capLast = last[0].toUpperCase() + last.slice(1)
  const capFirst = first[0].toUpperCase() + first.slice(1)
  return `${capLast}, ${capFirst}`
})

// Generator for jersey numbers (typical hockey range)
const jerseyNumberArb = fc.integer({ min: 1, max: 99 }).map(String)

// Generator for borderline name pairs (JW similarity in 0.83-0.88 range)
// For strings of length N using chars a-m, changing the last K chars to 'z'
// produces predictable JW similarity. We use this to construct borderline pairs.
const borderlinePairArb = fc.tuple(
  fc.stringMatching(/^[a-m]{8,12}$/),
  fc.constantFrom(2, 3, 4)
).map(([base, numChanges]) => {
  const chars = base.split('')
  for (let i = 0; i < numChanges && i < chars.length; i++) {
    chars[chars.length - 1 - i] = 'z'
  }
  const variant = chars.join('')
  const sim = jaroWinkler(base, variant)
  return { name1: base, name2: variant, sim }
}).filter(({ sim }) => sim > SIMILARITY_THRESHOLD - JERSEY_NUMBER_BOOST && sim <= SIMILARITY_THRESHOLD)

describe('Property 10: Player identity clustering correctness', () => {
  it('players with identical names are clustered together', () => {
    fc.assert(
      fc.property(
        playerNameArb,
        jerseyNumberArb,
        fc.integer({ min: 1, max: 82 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (baseName, number, gp, g, a) => {
          // Identical names have similarity = 1.0, well above 0.88
          const seasons = [
            {
              seasonName: 'Winter 2020',
              seasonId: '1',
              skaters: [{ name: baseName, number, gp, g, a, pts: g + a, pim: 0 }]
            },
            {
              seasonName: 'Winter 2021',
              seasonId: '2',
              skaters: [{ name: baseName, number, gp, g, a, pts: g + a, pim: 0 }]
            }
          ]

          const profiles = buildPlayerProfiles(seasons)
          expect(profiles.length).toBe(1)
          expect(profiles[0].seasons.length).toBe(2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('players with dissimilar names (below threshold, no number boost) remain in separate clusters', () => {
    fc.assert(
      fc.property(
        playerNameArb,
        playerNameArb,
        jerseyNumberArb,
        jerseyNumberArb,
        fc.integer({ min: 1, max: 82 }),
        (name1, name2, num1, num2, gp) => {
          const norm1 = normalizeName(name1)
          const norm2 = normalizeName(name2)

          const similarity = jaroWinkler(norm1, norm2)
          const numBoost = (num1 && num2 && num1 === num2) ? JERSEY_NUMBER_BOOST : 0
          const score = similarity + numBoost

          // Pre-condition: score must be at or below threshold
          fc.pre(score <= SIMILARITY_THRESHOLD)

          const seasons = [
            {
              seasonName: 'Winter 2020',
              seasonId: '1',
              skaters: [{ name: name1, number: num1, gp, g: 5, a: 5, pts: 10, pim: 0 }]
            },
            {
              seasonName: 'Winter 2021',
              seasonId: '2',
              skaters: [{ name: name2, number: num2, gp, g: 3, a: 4, pts: 7, pim: 2 }]
            }
          ]

          const profiles = buildPlayerProfiles(seasons)
          expect(profiles.length).toBe(2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('jersey number boost can push borderline names above the threshold into same cluster', () => {
    fc.assert(
      fc.property(
        borderlinePairArb,
        jerseyNumberArb,
        fc.integer({ min: 1, max: 82 }),
        ({ name1, name2, sim }, number, gp) => {
          // Verify: similarity alone does NOT exceed threshold
          expect(sim).toBeLessThanOrEqual(SIMILARITY_THRESHOLD)
          // But with jersey boost it DOES exceed threshold
          expect(sim + JERSEY_NUMBER_BOOST).toBeGreaterThan(SIMILARITY_THRESHOLD)

          // With same number: should cluster together
          const seasons = [
            {
              seasonName: 'Winter 2020',
              seasonId: '1',
              skaters: [{ name: name1, number, gp, g: 5, a: 5, pts: 10, pim: 0 }]
            },
            {
              seasonName: 'Winter 2021',
              seasonId: '2',
              skaters: [{ name: name2, number, gp, g: 3, a: 4, pts: 7, pim: 2 }]
            }
          ]

          const profiles = buildPlayerProfiles(seasons)
          expect(profiles.length).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('the clustering decision is consistent with jaroWinkler + numBoost > threshold formula', () => {
    fc.assert(
      fc.property(
        playerNameArb,
        playerNameArb,
        fc.boolean(),
        jerseyNumberArb,
        jerseyNumberArb,
        fc.integer({ min: 1, max: 82 }),
        (name1, name2, sameNumber, num1, num2, gp) => {
          const actualNum1 = num1
          const actualNum2 = sameNumber ? num1 : num2

          const norm1 = normalizeName(name1)
          const norm2 = normalizeName(name2)
          const similarity = jaroWinkler(norm1, norm2)

          const numBoost = (actualNum1 && actualNum2 && actualNum1 === actualNum2) ? JERSEY_NUMBER_BOOST : 0
          const score = similarity + numBoost

          // Skip if names normalize to the same thing (trivial case)
          fc.pre(norm1 !== norm2)
          // Skip the exact boundary to avoid floating point ambiguity
          fc.pre(Math.abs(score - SIMILARITY_THRESHOLD) > 0.001)

          const seasons = [
            {
              seasonName: 'Winter 2020',
              seasonId: '1',
              skaters: [{ name: name1, number: actualNum1, gp, g: 5, a: 5, pts: 10, pim: 0 }]
            },
            {
              seasonName: 'Winter 2021',
              seasonId: '2',
              skaters: [{ name: name2, number: actualNum2, gp, g: 3, a: 4, pts: 7, pim: 2 }]
            }
          ]

          const profiles = buildPlayerProfiles(seasons)

          if (score > SIMILARITY_THRESHOLD) {
            expect(profiles.length).toBe(1)
          } else {
            expect(profiles.length).toBe(2)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
