/**
 * Main aggregation orchestrator.
 *
 * Runs all aggregation modules in the correct order to produce pre-computed
 * JSON indexes from raw archive data. Output lands in public/data/ so Vite
 * copies it unmodified into the build.
 *
 * Order:
 *   1. Season catalog
 *   2. Player index
 *   3. Goalie index
 *   4. Team index
 *   5. Head-to-head
 *   6. Leaders
 *   7. Search index
 *   8. Suspensions
 *   9. Copy static files (games + divisions)
 *
 * Requirements: 3.9, 3.10, 2.2
 */

import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildSeasonCatalog } from './aggregate/seasonCatalog.mjs';
import { buildPlayerIndex } from './aggregate/playerIndex.mjs';
import { buildGoalieIndex } from './aggregate/goalieIndex.mjs';
import { buildTeamIndex } from './aggregate/teamIndex.mjs';
import { buildHeadToHead } from './aggregate/headToHead.mjs';
import { buildLeadersFromFiles } from './aggregate/leaders.mjs';
import { buildSearchIndex, writeSearchIndex } from './aggregate/searchIndex.mjs';
import { buildSuspensions } from './aggregate/suspensions.mjs';
import { copyStaticFiles } from './aggregate/copyStaticFiles.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const ARCHIVE_ROOT = resolve(PROJECT_ROOT, 'archive');
const DIVISIONS_DIR = resolve(ARCHIVE_ROOT, 'divisions');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'public', 'data');

/**
 * Extract unique teams from the season catalog for the search index.
 * Mirrors the logic in searchIndex.mjs standalone mode.
 */
function extractTeamsFromCatalog(catalog) {
  const teams = [];
  const seen = new Set();
  for (const season of (catalog.seasons || [])) {
    for (const div of (season.divisions || [])) {
      for (const [teamId, teamName] of Object.entries(div.teams || {})) {
        if (seen.has(teamId)) continue;
        seen.add(teamId);
        teams.push({ teamId, teamName });
      }
    }
  }
  return teams;
}

/**
 * Run a named aggregation step with error handling.
 * Returns the step's result on success, or undefined on failure.
 */
async function runStep(name, fn) {
  try {
    console.log(`\n── ${name} ──`);
    const result = await fn();
    console.log(`  ✓ ${name} complete`);
    return result;
  } catch (err) {
    console.error(`  ✗ ${name} FAILED: ${err.message}`);
    if (err.stack) console.error(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
    return undefined;
  }
}

async function main() {
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Fairfax Archive — Data Aggregation    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nArchive source: ${DIVISIONS_DIR}`);
  console.log(`Output target:  ${OUTPUT_DIR}`);

  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });

  // ── 1. Season Catalog ──────────────────────────────────────────────────────
  const catalog = await runStep('Season Catalog', async () => {
    const result = await buildSeasonCatalog(DIVISIONS_DIR);
    const outputPath = resolve(OUTPUT_DIR, 'season-catalog.json');
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`    ${result.seasons.length} seasons indexed`);
    return result;
  });

  // ── 2. Player Index ────────────────────────────────────────────────────────
  const allPlayers = await runStep('Player Index', async () => {
    return await buildPlayerIndex(DIVISIONS_DIR, OUTPUT_DIR);
  });

  // ── 3. Goalie Index ────────────────────────────────────────────────────────
  const allGoalies = await runStep('Goalie Index', async () => {
    return await buildGoalieIndex(DIVISIONS_DIR, OUTPUT_DIR);
  });

  // ── 4. Team Index ──────────────────────────────────────────────────────────
  await runStep('Team Index', async () => {
    await buildTeamIndex(ARCHIVE_ROOT, OUTPUT_DIR);
  });

  // ── 5. Head-to-Head ────────────────────────────────────────────────────────
  await runStep('Head-to-Head', async () => {
    await buildHeadToHead(DIVISIONS_DIR, OUTPUT_DIR);
  });

  // ── 6. Leaders ─────────────────────────────────────────────────────────────
  await runStep('Leaders', async () => {
    await buildLeadersFromFiles(OUTPUT_DIR);
  });

  // ── 7. Search Index ────────────────────────────────────────────────────────
  await runStep('Search Index', async () => {
    const teams = catalog ? extractTeamsFromCatalog(catalog) : [];
    const players = allPlayers || [];
    const goalies = allGoalies || [];
    const index = buildSearchIndex(players, goalies, teams);
    await writeSearchIndex(index);
  });

  // ── 8. Suspensions ─────────────────────────────────────────────────────────
  await runStep('Suspensions', async () => {
    await buildSuspensions(DIVISIONS_DIR, OUTPUT_DIR);
  });

  // ── 9. Copy Static Files ───────────────────────────────────────────────────
  await runStep('Copy Static Files', async () => {
    const { games, divisions } = await copyStaticFiles(ARCHIVE_ROOT, OUTPUT_DIR);
    console.log(`    ${games} game files → public/data/games/`);
    console.log(`    ${divisions} division files → public/data/divisions/`);
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║   Aggregation complete in ${elapsed.padStart(6)}s       ║`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('\nFatal aggregation error:', err);
  process.exit(1);
});
