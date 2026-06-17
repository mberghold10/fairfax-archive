/**
 * Pre-compute per-division (per-league) statistical leaders.
 *
 * For each division, reads the reconstructed per-team rosters (or reconstructs
 * them on the fly) and produces small leaderboards:
 *   - points, goals, assists (skaters)
 *   - wins, gaa (goalies, min games filter)
 *
 * Player IDs are generated with the same SHA-256 scheme as the player index so
 * the frontend can link to /players/{id}.
 *
 * Output: public/data/divisions/{divId}/leaders.json
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeName } from '../../src/utils/playerIdentity.mjs';
import { buildPlayerTeamMap, reconstructDivisionRosters } from './rosterTeams.mjs';

const TOP_N = 10;
const MIN_GOALIE_GAMES = 5;

function playerId(name) {
  return createHash('sha256').update(normalizeName(name)).digest('hex').slice(0, 12);
}

function isSubstitute(name) {
  return !name || /^substit/i.test(name);
}

/**
 * Flatten all skaters/goalies from a records object into arrays tagged with team.
 */
function collectPlayers(records) {
  const skaters = [];
  const goalies = [];
  for (const teamData of Object.values(records)) {
    for (const s of (teamData.skaters || [])) {
      if (isSubstitute(s.name)) continue;
      skaters.push(s);
    }
    for (const g of (teamData.goalies || [])) {
      if (isSubstitute(g.name)) continue;
      goalies.push(g);
    }
  }
  return { skaters, goalies };
}

function topSkaters(skaters, statKey) {
  return skaters
    .map(s => ({
      id: playerId(s.name),
      name: s.name,
      teamId: s.team?.teamId || '',
      teamName: s.team?.name || '',
      value: s[statKey] || 0,
    }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

function topGoaliesByWins(goalies) {
  return goalies
    .map(g => ({
      id: playerId(g.name),
      name: g.name,
      teamId: g.team?.teamId || '',
      teamName: g.team?.name || '',
      value: g.w || 0,
    }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

function topGoaliesByGaa(goalies) {
  return goalies
    .filter(g => (g.gp || 0) >= MIN_GOALIE_GAMES)
    .map(g => ({
      id: playerId(g.name),
      name: g.name,
      teamId: g.team?.teamId || '',
      teamName: g.team?.name || '',
      value: parseFloat(g.gaa) || 0,
    }))
    .filter(e => e.value > 0)
    .sort((a, b) => a.value - b.value) // lower GAA is better
    .slice(0, TOP_N);
}

export async function buildDivisionLeaders(archiveRoot, outputDir) {
  const divisionsDir = resolve(archiveRoot, 'divisions');
  const gamesDir = resolve(archiveRoot, 'games');
  const outputDivisionsDir = resolve(outputDir, 'divisions');

  const divEntries = await readdir(divisionsDir, { withFileTypes: true });
  const divFolders = divEntries.filter(d => d.isDirectory());

  let count = 0;

  for (const dir of divFolders) {
    const divId = dir.name;
    const divPath = join(divisionsDir, divId);

    let meta, roster, schedule;
    try {
      meta = JSON.parse(await readFile(join(divPath, 'meta.json'), 'utf-8'));
    } catch {
      continue;
    }
    try {
      roster = JSON.parse(await readFile(join(divPath, 'rosters.regular.json'), 'utf-8'));
    } catch {
      continue;
    }
    try {
      schedule = JSON.parse(await readFile(join(divPath, 'schedule.regular.json'), 'utf-8'));
    } catch {
      schedule = null;
    }

    if (!roster.records) continue;

    // Reconstruct per-team rosters for single-bucket divisions
    let records = roster.records;
    const recordKeys = Object.keys(records);
    const metaTeamCount = Object.keys(meta.teams || {}).length;
    if (recordKeys.length === 1 && metaTeamCount > 1) {
      const gameIds = schedule?.records
        ? schedule.records.filter(g => g.gameId).map(g => g.gameId)
        : [];
      const playerTeamMap = await buildPlayerTeamMap(gamesDir, gameIds);
      const reconstructed = reconstructDivisionRosters(meta, roster, playerTeamMap);
      if (reconstructed) records = reconstructed;
    }

    const { skaters, goalies } = collectPlayers(records);
    if (skaters.length === 0 && goalies.length === 0) continue;

    const leaders = {
      points: topSkaters(skaters, 'pts'),
      goals: topSkaters(skaters, 'g'),
      assists: topSkaters(skaters, 'a'),
      wins: topGoaliesByWins(goalies),
      gaa: topGoaliesByGaa(goalies),
    };

    const outDir = join(outputDivisionsDir, divId);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, 'leaders.json'),
      JSON.stringify({ divId, leaders }, null, 2),
      'utf-8'
    );
    count++;
  }

  console.log(`    ${count} division leader files computed`);
  return count;
}
