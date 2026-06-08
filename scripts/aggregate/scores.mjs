/**
 * Pre-compute game scores per division for display in the schedule.
 *
 * For each division, reads the game files referenced in the schedules
 * (regular + playoff) and writes a scores.json mapping gameId → result.
 *
 * The game file's own home/away team IDs are authoritative (the schedule's
 * home/away can be swapped), so each result records scores keyed by teamId.
 *
 * Result shape per gameId:
 *   {
 *     homeTeamId, awayTeamId,
 *     homeScore, awayScore,
 *     ot: boolean,            // decided in overtime
 *     winnerTeamId | null,    // null when tied
 *     tie: boolean
 *   }
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

async function collectGameIds(divPath) {
  const ids = [];
  for (const file of ['schedule.regular.json', 'schedule.playoff.json']) {
    try {
      const raw = await readFile(join(divPath, file), 'utf-8');
      const sched = JSON.parse(raw);
      if (sched.records) {
        for (const g of sched.records) {
          if (g.gameId) ids.push(g.gameId);
        }
      }
    } catch {
      // file missing — skip
    }
  }
  return ids;
}

export async function buildScores(archiveRoot, outputDir) {
  const divisionsDir = resolve(archiveRoot, 'divisions');
  const gamesDir = resolve(archiveRoot, 'games');
  const outputDivisionsDir = resolve(outputDir, 'divisions');

  const divEntries = await readdir(divisionsDir, { withFileTypes: true });
  const divFolders = divEntries.filter(d => d.isDirectory());

  let count = 0;

  for (const dir of divFolders) {
    const divId = dir.name;
    const divPath = join(divisionsDir, divId);

    const gameIds = await collectGameIds(divPath);
    if (gameIds.length === 0) continue;

    const scores = {};

    for (const gameId of gameIds) {
      let game;
      try {
        const raw = await readFile(join(gamesDir, `${gameId}.json`), 'utf-8');
        game = JSON.parse(raw);
      } catch {
        continue; // game not played / missing
      }

      if (!game.scoring || !game.home || !game.away) continue;

      const homeId = String(game.home.teamId);
      const awayId = String(game.away.teamId);
      const homeScore = game.scoring.home?.final;
      const awayScore = game.scoring.away?.final;

      if (homeScore == null || awayScore == null) continue;

      const ot = (game.scoring.home?.ot || 0) > 0 || (game.scoring.away?.ot || 0) > 0;
      const tie = homeScore === awayScore;
      let winnerTeamId = null;
      if (!tie) {
        winnerTeamId = homeScore > awayScore ? homeId : awayId;
      }

      scores[gameId] = {
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeScore,
        awayScore,
        ot,
        tie,
        winnerTeamId,
      };
    }

    if (Object.keys(scores).length === 0) continue;

    const outDir = join(outputDivisionsDir, divId);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, 'scores.json'),
      JSON.stringify({ divId, scores }, null, 2),
      'utf-8'
    );
    count++;
  }

  console.log(`    ${count} division score files computed`);
  return count;
}
