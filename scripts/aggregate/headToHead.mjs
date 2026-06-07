/**
 * Head-to-Head Index Builder
 *
 * Reads all schedule files from the archive, loads corresponding game files
 * to get final scores, computes win/loss/tie records for every team pair,
 * and writes:
 *   - public/data/head-to-head.json
 *
 * Requirements: 3.6, 8.1, 8.2
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Create a sorted matchup key from two team IDs.
 * The smaller teamId comes first for consistent lookups.
 */
function matchupKey(teamId1, teamId2) {
  return teamId1 < teamId2
    ? `${teamId1}-${teamId2}`
    : `${teamId2}-${teamId1}`;
}

/**
 * Compute a head-to-head matchup record from a list of completed games
 * between two teams. This is a pure function suitable for property testing.
 *
 * @param {Array<{homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number, date: string, gameId: string, seasonName?: string, divId?: string}>} games
 * @returns {{team1: {teamId: string, name: string, wins: number}, team2: {teamId: string, name: string, wins: number}, ties: number, games: Array}} The matchup record
 */
export function computeMatchupFromGames(games) {
  if (!games || games.length === 0) {
    return { team1: { teamId: '', name: '', wins: 0 }, team2: { teamId: '', name: '', wins: 0 }, ties: 0, games: [] };
  }

  // Determine team1 and team2 from the first game (smaller ID = team1)
  const firstGame = games[0];
  const allTeamIds = new Set();
  allTeamIds.add(firstGame.homeTeamId);
  allTeamIds.add(firstGame.awayTeamId);
  const [t1Id, t2Id] = [firstGame.homeTeamId, firstGame.awayTeamId].sort();

  const record = {
    team1: { teamId: t1Id, name: t1Id, wins: 0 },
    team2: { teamId: t2Id, name: t2Id, wins: 0 },
    ties: 0,
    games: []
  };

  for (const game of games) {
    const { homeTeamId, awayTeamId, homeScore, awayScore } = game;

    // Determine winner
    if (homeScore > awayScore) {
      // Home team won
      if (homeTeamId === t1Id) {
        record.team1.wins++;
      } else {
        record.team2.wins++;
      }
    } else if (awayScore > homeScore) {
      // Away team won
      if (awayTeamId === t1Id) {
        record.team1.wins++;
      } else {
        record.team2.wins++;
      }
    } else {
      // Tie
      record.ties++;
    }

    // Add game to list
    record.games.push({
      gameId: String(game.gameId || ''),
      date: game.date || '',
      seasonName: game.seasonName || '',
      divId: String(game.divId || ''),
      homeTeamId: homeTeamId,
      score: { home: homeScore, away: awayScore }
    });
  }

  // Sort games by date descending (most recent first)
  record.games.sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return 0;
  });

  return record;
}

/**
 * Build the head-to-head index from archive data.
 *
 * @param {string} archiveDir - Path to archive/divisions/
 * @param {string} outputDir - Path to public/data/
 * @returns {Promise<object>} The head-to-head index object
 */
export async function buildHeadToHead(archiveDir, outputDir) {
  console.log('  Building head-to-head index...');

  const gamesDir = resolve(archiveDir, '..', 'games');
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  // Map to accumulate matchup data: key → { team1, team2, ties, games[] }
  const matchups = new Map();

  let gamesProcessed = 0;
  let gamesSkipped = 0;

  for (const dir of divDirs) {
    const divPath = join(archiveDir, dir.name);
    const divId = dir.name;

    // Read meta.json for seasonName
    let meta;
    try {
      const metaRaw = await readFile(join(divPath, 'meta.json'), 'utf-8');
      meta = JSON.parse(metaRaw);
    } catch {
      continue;
    }

    const seasonName = meta.seasonName || '';

    // Process both regular and playoff schedule files
    for (const mode of ['regular', 'playoff']) {
      const schedulePath = join(divPath, `schedule.${mode}.json`);
      let scheduleData;
      try {
        const raw = await readFile(schedulePath, 'utf-8');
        scheduleData = JSON.parse(raw);
      } catch {
        // Playoff schedule may not exist
        continue;
      }

      const records = scheduleData.records || [];

      for (const game of records) {
        if (!game.gameId) continue;

        const homeTeamId = game.home?.teamId;
        const awayTeamId = game.away?.teamId;
        if (!homeTeamId || !awayTeamId) continue;

        // Read the game file to get scores
        let gameData;
        try {
          const gameRaw = await readFile(join(gamesDir, `${game.gameId}.json`), 'utf-8');
          gameData = JSON.parse(gameRaw);
        } catch {
          gamesSkipped++;
          continue;
        }

        // Only include games that have scores
        const homeScore = gameData.scoring?.home?.final;
        const awayScore = gameData.scoring?.away?.final;
        if (homeScore == null || awayScore == null) {
          gamesSkipped++;
          continue;
        }

        gamesProcessed++;

        const key = matchupKey(homeTeamId, awayTeamId);

        if (!matchups.has(key)) {
          // Determine which is team1 (smaller ID) and team2
          const [t1Id, t2Id] = homeTeamId < awayTeamId
            ? [homeTeamId, awayTeamId]
            : [awayTeamId, homeTeamId];

          const t1Name = homeTeamId < awayTeamId
            ? (game.home.name || '')
            : (game.away.name || '');
          const t2Name = homeTeamId < awayTeamId
            ? (game.away.name || '')
            : (game.home.name || '');

          matchups.set(key, {
            team1: { teamId: t1Id, name: t1Name, wins: 0 },
            team2: { teamId: t2Id, name: t2Name, wins: 0 },
            ties: 0,
            games: []
          });
        }

        const record = matchups.get(key);

        // Determine winner
        if (homeScore > awayScore) {
          // Home team won
          if (homeTeamId === record.team1.teamId) {
            record.team1.wins++;
          } else {
            record.team2.wins++;
          }
        } else if (awayScore > homeScore) {
          // Away team won
          if (awayTeamId === record.team1.teamId) {
            record.team1.wins++;
          } else {
            record.team2.wins++;
          }
        } else {
          // Tie
          record.ties++;
        }

        // Add game to the list
        record.games.push({
          gameId: String(game.gameId),
          date: game.date || gameData.date || '',
          seasonName: game.seasonName || seasonName,
          divId: String(game.divId || divId),
          homeTeamId: homeTeamId,
          score: { home: homeScore, away: awayScore }
        });
      }
    }
  }

  // Sort games within each matchup by date descending (most recent first)
  for (const record of matchups.values()) {
    record.games.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });
  }

  // Build output object
  const output = { matchups: {} };
  for (const [key, record] of matchups) {
    output.matchups[key] = record;
  }

  // Write output
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'head-to-head.json'),
    JSON.stringify(output),
    'utf-8'
  );

  const matchupCount = matchups.size;
  console.log(`    ✓ head-to-head.json: ${matchupCount} matchups, ${gamesProcessed} games processed (${gamesSkipped} skipped)`);

  return output;
}

/**
 * Standalone execution
 */
async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive', 'divisions');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading schedule/game data from: ${archiveDir}`);

  const result = await buildHeadToHead(archiveDir, outputDir);
  console.log(`\nDone. ${Object.keys(result.matchups).length} matchups indexed.`);
}

// Run standalone when executed directly
const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main().catch(err => {
    console.error('Head-to-head index build failed:', err);
    process.exit(1);
  });
}
