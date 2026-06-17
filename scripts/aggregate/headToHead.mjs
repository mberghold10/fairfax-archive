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
 * Convert a team name to its canonical slug — mirrors TeamLink.jsx.
 */
function toTeamSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Create a sorted matchup key from two team slugs.
 */
function matchupKey(slug1, slug2) {
  return slug1 < slug2 ? `${slug1}-${slug2}` : `${slug2}-${slug1}`;
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
      score: { home: homeScore, away: awayScore },
      playoff: game.playoff || false,
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

        // Read the game file to get scores (and authoritative team IDs)
        let gameData;
        try {
          const gameRaw = await readFile(join(gamesDir, `${game.gameId}.json`), 'utf-8');
          gameData = JSON.parse(gameRaw);
        } catch {
          gamesSkipped++;
          continue;
        }

        // Use game file teamIds as authoritative — playoff schedule entries have null teamIds
        const homeTeamId = gameData.home?.teamId ? String(gameData.home.teamId) : String(game.home?.teamId || '');
        const awayTeamId = gameData.away?.teamId ? String(gameData.away.teamId) : String(game.away?.teamId || '');
        if (!homeTeamId || !awayTeamId) continue;

        // Only include games that have scores
        const homeScore = gameData.scoring?.home?.final;
        const awayScore = gameData.scoring?.away?.final;
        if (homeScore == null || awayScore == null) {
          gamesSkipped++;
          continue;
        }

        gamesProcessed++;

        // Use team name slugs as the matchup key so that teams with multiple IDs
        // across seasons (e.g. Pharaohs=1962/1911/1848...) roll up into one matchup.
        const homeName = gameData.home.name || game.home?.name || homeTeamId;
        const awayName = gameData.away.name || game.away?.name || awayTeamId;
        const homeSlug = toTeamSlug(homeName);
        const awaySlug = toTeamSlug(awayName);
        const key = matchupKey(homeSlug, awaySlug);

        if (!matchups.has(key)) {
          const [t1Slug, t2Slug] = homeSlug < awaySlug
            ? [homeSlug, awaySlug]
            : [awaySlug, homeSlug];
          const t1Name = homeSlug < awaySlug ? homeName : awayName;
          const t2Name = homeSlug < awaySlug ? awayName : homeName;
          // Store a representative teamId (most recent wins; we update if we see higher)
          const t1Id = homeSlug < awaySlug ? homeTeamId : awayTeamId;
          const t2Id = homeSlug < awaySlug ? awayTeamId : homeTeamId;

          matchups.set(key, {
            team1: { teamId: t1Id, name: t1Name, wins: 0 },
            team2: { teamId: t2Id, name: t2Name, wins: 0 },
            ties: 0,
            games: []
          });
        }

        const record = matchups.get(key);

        // Update to most recent teamId (higher number = more recent season)
        const t1IsHome = homeSlug === toTeamSlug(record.team1.name);
        const currentT1Id = record.team1.teamId;
        const currentT2Id = record.team2.teamId;
        if (t1IsHome && Number(homeTeamId) > Number(currentT1Id)) record.team1.teamId = homeTeamId;
        if (!t1IsHome && Number(awayTeamId) > Number(currentT1Id)) record.team1.teamId = awayTeamId;
        if (t1IsHome && Number(awayTeamId) > Number(currentT2Id)) record.team2.teamId = awayTeamId;
        if (!t1IsHome && Number(homeTeamId) > Number(currentT2Id)) record.team2.teamId = homeTeamId;

        // Determine winner using homeTeamId/awayTeamId vs the slug-based team1
        const homeIsTeam1 = toTeamSlug(homeName) === toTeamSlug(record.team1.name);
        if (homeScore > awayScore) {
          if (homeIsTeam1) record.team1.wins++; else record.team2.wins++;
        } else if (awayScore > homeScore) {
          if (!homeIsTeam1) record.team1.wins++; else record.team2.wins++;
        } else {
          record.ties++;
        }

        // Add game to the list
        record.games.push({
          gameId: String(game.gameId),
          date: game.date || gameData.date || '',
          seasonName: game.seasonName || seasonName,
          divId: String(game.divId || divId),
          homeTeamId: homeTeamId,
          homeTeamSlug: homeSlug,
          score: { home: homeScore, away: awayScore },
          playoff: mode === 'playoff',
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
