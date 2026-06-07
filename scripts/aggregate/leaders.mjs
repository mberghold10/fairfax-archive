/**
 * Leaders Index Builder
 *
 * Reads the all-players and all-goalies indexes and produces top-100 leaderboards
 * for goals, assists, points, PIM (skaters) and wins, shutouts (goalies).
 * Writes public/data/leaders.json.
 *
 * Requirements: 3.5, 9.1, 9.2
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_N = 100;

/**
 * Build leaders from pre-loaded player and goalie arrays.
 * Pure function — no I/O, suitable for testing.
 *
 * @param {Array} allPlayers - Array of PlayerIndexEntry objects (id, displayName, totals)
 * @param {Array} allGoalies - Array of GoalieIndexEntry objects (id, displayName, totals)
 * @returns {object} LeadersIndex with goals, assists, points, pim, wins, shutouts arrays
 */
export function buildLeaders(allPlayers, allGoalies) {
  const goals = allPlayers
    .map(p => ({ playerId: p.id, displayName: p.displayName, value: p.totals.g }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  const assists = allPlayers
    .map(p => ({ playerId: p.id, displayName: p.displayName, value: p.totals.a }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  const points = allPlayers
    .map(p => ({ playerId: p.id, displayName: p.displayName, value: p.totals.pts }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  const pim = allPlayers
    .map(p => ({ playerId: p.id, displayName: p.displayName, value: p.totals.pim }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  const wins = allGoalies
    .map(g => ({ goalieId: g.id, displayName: g.displayName, value: g.totals.w }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  const shutouts = allGoalies
    .map(g => ({ goalieId: g.id, displayName: g.displayName, value: g.totals.so }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  return { goals, assists, points, pim, wins, shutouts };
}

/**
 * Write the leaders index to a JSON file.
 *
 * @param {object} leaders - LeadersIndex object from buildLeaders()
 * @param {string} outputDir - Path to the output directory (e.g. public/data/)
 */
export async function writeLeaders(leaders, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'leaders.json');
  await writeFile(outputPath, JSON.stringify(leaders, null, 2), 'utf-8');
  return outputPath;
}

/**
 * Build leaders from files on disk. Reads all-players.json and all-goalies.json
 * from the given outputDir, builds leaders, and writes leaders.json.
 *
 * @param {string} outputDir - Path to public/data/ directory (both input and output)
 * @returns {Promise<object>} The LeadersIndex object
 */
export async function buildLeadersFromFiles(outputDir) {
  console.log('  Building leaders index...');

  const playersPath = join(outputDir, 'all-players.json');
  const goaliesPath = join(outputDir, 'all-goalies.json');

  const allPlayers = JSON.parse(await readFile(playersPath, 'utf-8'));
  const allGoalies = JSON.parse(await readFile(goaliesPath, 'utf-8'));

  console.log(`    Read ${allPlayers.length} players, ${allGoalies.length} goalies`);

  const leaders = buildLeaders(allPlayers, allGoalies);

  const outputPath = await writeLeaders(leaders, outputDir);

  console.log(`    ✓ leaders.json: ${leaders.goals.length} goals, ${leaders.assists.length} assists, ${leaders.points.length} points, ${leaders.pim.length} pim, ${leaders.wins.length} wins, ${leaders.shutouts.length} shutouts`);

  return leaders;
}

// ── Standalone execution ────────────────────────────────────────────────────

async function main() {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const projectRoot = resolve(__dirname, '..', '..');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading from and writing to: ${outputDir}`);

  const startTime = Date.now();
  await buildLeadersFromFiles(outputDir);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nLeaders index build completed in ${elapsed}s`);
}

// Run standalone when executed directly
const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch(err => {
    console.error('Leaders index build failed:', err);
    process.exit(1);
  });
}
