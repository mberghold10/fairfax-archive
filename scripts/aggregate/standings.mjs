/**
 * Pre-compute standings for each division from game results.
 *
 * For each division, reads all game files referenced in schedule.regular.json
 * and computes W/L/T/GF/GA/PTS per team. Outputs a standings.json alongside
 * other division data in public/data/divisions/{divId}/.
 *
 * Point system: W=2, T=1, L=0
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/**
 * Build standings for all divisions.
 * @param {string} archiveRoot - path to the archive/ directory
 * @param {string} outputDir - path to public/data/
 */
export async function buildStandings(archiveRoot, outputDir) {
  const divisionsDir = resolve(archiveRoot, 'divisions');
  const gamesDir = resolve(archiveRoot, 'games');
  const outputDivisionsDir = resolve(outputDir, 'divisions');

  const divEntries = await readdir(divisionsDir, { withFileTypes: true });
  const divFolders = divEntries.filter(d => d.isDirectory());

  let count = 0;

  for (const dir of divFolders) {
    const divId = dir.name;
    const divPath = join(divisionsDir, divId);

    // Read meta.json for team list
    let meta;
    try {
      const metaRaw = await readFile(join(divPath, 'meta.json'), 'utf-8');
      meta = JSON.parse(metaRaw);
    } catch {
      continue; // Skip divisions without meta
    }

    if (!meta.teams || Object.keys(meta.teams).length === 0) continue;

    // Read schedule to get game IDs
    let schedule;
    try {
      const schedRaw = await readFile(join(divPath, 'schedule.regular.json'), 'utf-8');
      schedule = JSON.parse(schedRaw);
    } catch {
      continue;
    }

    if (!schedule.records || schedule.records.length === 0) continue;

    // Initialize standings per team
    const standings = {};
    for (const [teamId, teamName] of Object.entries(meta.teams)) {
      standings[teamId] = {
        teamId,
        team: teamName,
        gp: 0,
        w: 0,
        l: 0,
        t: 0,
        gf: 0,
        ga: 0,
        pts: 0,
      };
    }

    // Process each game
    const gameIds = schedule.records
      .filter(g => g.gameId)
      .map(g => g.gameId);

    for (const gameId of gameIds) {
      let game;
      try {
        const gameRaw = await readFile(join(gamesDir, `${gameId}.json`), 'utf-8');
        game = JSON.parse(gameRaw);
      } catch {
        continue; // Game file missing
      }

      if (!game.scoring || !game.home || !game.away) continue;

      const homeId = game.home.teamId;
      const awayId = game.away.teamId;
      const homeScore = game.scoring.home?.final;
      const awayScore = game.scoring.away?.final;

      if (homeScore == null || awayScore == null) continue;

      // Ensure teams exist in standings (may have been added mid-season)
      if (!standings[homeId]) {
        standings[homeId] = {
          teamId: homeId,
          team: game.home.name || `Team ${homeId}`,
          gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0, pts: 0,
        };
      }
      if (!standings[awayId]) {
        standings[awayId] = {
          teamId: awayId,
          team: game.away.name || `Team ${awayId}`,
          gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0, pts: 0,
        };
      }

      // Update home team
      standings[homeId].gp++;
      standings[homeId].gf += homeScore;
      standings[homeId].ga += awayScore;

      // Update away team
      standings[awayId].gp++;
      standings[awayId].gf += awayScore;
      standings[awayId].ga += homeScore;

      if (homeScore > awayScore) {
        standings[homeId].w++;
        standings[homeId].pts += 2;
        standings[awayId].l++;
      } else if (awayScore > homeScore) {
        standings[awayId].w++;
        standings[awayId].pts += 2;
        standings[homeId].l++;
      } else {
        // Tie
        standings[homeId].t++;
        standings[homeId].pts += 1;
        standings[awayId].t++;
        standings[awayId].pts += 1;
      }
    }

    // Sort by points descending, then by wins, then by goal differential
    const sorted = Object.values(standings).sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.w !== a.w) return b.w - a.w;
      return (b.gf - b.ga) - (a.gf - a.ga);
    });

    // Write standings file
    const outDir = join(outputDivisionsDir, divId);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, 'standings.json'),
      JSON.stringify({ divId, standings: sorted }, null, 2),
      'utf-8'
    );
    count++;
  }

  console.log(`    ${count} division standings computed`);
  return count;
}
