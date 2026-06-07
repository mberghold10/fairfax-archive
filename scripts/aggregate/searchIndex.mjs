/**
 * Search Index Builder
 * Collects all resolved player display names and team names with their IDs,
 * produces normalized (lowercased, stripped) versions, and writes search-index.json.
 *
 * Can be called programmatically via buildSearchIndex(allPlayers, allGoalies, teams)
 * or run standalone (reads from public/data/).
 */

import { normalizeName } from '../../src/utils/playerIdentity.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public/data')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'search-index.json')

/**
 * Build the search index from pre-computed player/goalie/team data.
 *
 * @param {Array} allPlayers - Array of player index entries with { id, displayName }
 * @param {Array} allGoalies - Array of goalie index entries with { id, displayName }
 * @param {Array} teams - Array of team entries with { teamId, teamName } (or objects with aliases)
 * @returns {{ players: SearchEntry[], teams: SearchEntry[] }}
 */
export function buildSearchIndex(allPlayers, allGoalies, teams) {
  const players = []
  const playerIdsSeen = new Set()

  // Add skaters
  for (const player of allPlayers) {
    if (!player.id || !player.displayName) continue
    if (playerIdsSeen.has(player.id)) continue
    playerIdsSeen.add(player.id)
    players.push({
      id: player.id,
      name: player.displayName,
      normalized: normalizeName(player.displayName),
      type: 'player'
    })
  }

  // Add goalies (avoid duplicates if a player appears in both lists)
  for (const goalie of allGoalies) {
    if (!goalie.id || !goalie.displayName) continue
    if (playerIdsSeen.has(goalie.id)) continue
    playerIdsSeen.add(goalie.id)
    players.push({
      id: goalie.id,
      name: goalie.displayName,
      normalized: normalizeName(goalie.displayName),
      type: 'player'
    })
  }

  // Build team entries
  const teamEntries = []
  const teamIdsSeen = new Set()

  for (const team of teams) {
    const teamId = team.teamId || team.id
    const teamName = team.teamName || team.name
    if (!teamId || !teamName) continue
    if (teamIdsSeen.has(teamId)) continue
    teamIdsSeen.add(teamId)
    teamEntries.push({
      id: teamId,
      name: teamName,
      normalized: normalizeName(teamName),
      type: 'team'
    })
  }

  return { players, teams: teamEntries }
}

/**
 * Write the search index to disk.
 * @param {{ players: SearchEntry[], teams: SearchEntry[] }} index
 */
export async function writeSearchIndex(index) {
  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(index, null, 2))
  console.log(`  ✓ search-index.json: ${index.players.length} players, ${index.teams.length} teams`)
}

// ── Standalone execution ────────────────────────────────────────────────────

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

/**
 * Extract unique teams from the season catalog.
 * The season catalog has seasons[].divisions[].teams as Record<teamId, teamName>.
 */
function extractTeamsFromCatalog(catalog) {
  const teams = []
  const seen = new Set()
  for (const season of (catalog.seasons || [])) {
    for (const div of (season.divisions || [])) {
      for (const [teamId, teamName] of Object.entries(div.teams || {})) {
        if (seen.has(teamId)) continue
        seen.add(teamId)
        teams.push({ teamId, teamName })
      }
    }
  }
  return teams
}

async function main() {
  console.log('Building search index...')

  const allPlayers = await loadJson(path.join(OUTPUT_DIR, 'all-players.json'))
  const allGoalies = await loadJson(path.join(OUTPUT_DIR, 'all-goalies.json'))

  // Try loading team data from season catalog (which has team lists per division)
  let teams = []
  try {
    const catalog = await loadJson(path.join(OUTPUT_DIR, 'season-catalog.json'))
    teams = extractTeamsFromCatalog(catalog)
  } catch {
    console.warn('  ⚠ Could not load season-catalog.json for team data, trying teams directory...')
    // Fallback: if individual team files exist, we could scan them
    // For now, teams will be empty if catalog is unavailable
  }

  const index = buildSearchIndex(allPlayers, allGoalies, teams)
  await writeSearchIndex(index)
}

// Run standalone when executed directly
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)

if (isMain) {
  main().catch(err => {
    console.error('Search index build failed:', err.message)
    process.exit(1)
  })
}
