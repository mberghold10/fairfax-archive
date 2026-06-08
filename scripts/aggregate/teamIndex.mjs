/**
 * Team Index Builder
 *
 * Reads all division metadata, roster files, and game files to produce
 * per-team detail JSON files at public/data/teams/{id}.json containing:
 * - Season-by-season records (W, L, T, PTS, placement)
 * - Roster snapshots per season
 * - Team name aliases (when teams appear across seasons with different names)
 *
 * Records are computed from game scores (home/away final) for each team
 * within each division's regular season schedule.
 *
 * Requirements: 3.7, 7.1, 7.2, 7.6
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlayerTeamMap, reconstructDivisionRosters } from './rosterTeams.mjs';

const __dirname = import.meta.url.startsWith('file:')
  ? fileURLToPath(new URL('.', import.meta.url))
  : '.';

/**
 * Builds team index files from archive data.
 *
 * @param {string} archiveDir - Path to the archive directory (contains divisions/ and games/)
 * @param {string} outputDir - Path to the output directory (public/data/)
 */
export async function buildTeamIndex(archiveDir, outputDir) {
  const divisionsDir = join(archiveDir, 'divisions');
  const gamesDir = join(archiveDir, 'games');

  const entries = await readdir(divisionsDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  // Collect per-division data: meta, schedule, rosters
  const divisionData = await Promise.all(
    divDirs.map(async (dir) => {
      const divPath = join(divisionsDir, dir.name);
      try {
        const [metaRaw, scheduleRaw, rosterRaw] = await Promise.all([
          readFile(join(divPath, 'meta.json'), 'utf-8').catch(() => null),
          readFile(join(divPath, 'schedule.regular.json'), 'utf-8').catch(() => null),
          readFile(join(divPath, 'rosters.regular.json'), 'utf-8').catch(() => null),
        ]);

        if (!metaRaw) return null;

        const meta = JSON.parse(metaRaw);
        const schedule = scheduleRaw ? JSON.parse(scheduleRaw) : null;
        const roster = rosterRaw ? JSON.parse(rosterRaw) : null;

        return { meta, schedule, roster, divId: dir.name };
      } catch (err) {
        console.warn(`Warning: Could not read division ${dir.name}: ${err.message}`);
        return null;
      }
    })
  );

  const validDivisions = divisionData.filter(d => d !== null);

  // Read game files to get scores — collect all gameIds needed
  const allGameIds = new Set();
  for (const div of validDivisions) {
    if (div.schedule && div.schedule.records) {
      for (const game of div.schedule.records) {
        if (game.gameId) {
          allGameIds.add(String(game.gameId));
        }
      }
    }
  }

  // Read game files in batches for scores
  const gameScores = await loadGameScores(gamesDir, allGameIds);

  // Reconstruct per-team rosters for single-bucket divisions using game data,
  // so team pages show each team's actual players rather than an empty roster.
  for (const div of validDivisions) {
    if (!div.roster || !div.meta.teams) continue;
    const recordKeys = Object.keys(div.roster.records || {});
    const metaTeamCount = Object.keys(div.meta.teams).length;
    if (recordKeys.length === 1 && metaTeamCount > 1) {
      const gameIds = div.schedule?.records
        ? div.schedule.records.filter(g => g.gameId).map(g => g.gameId)
        : [];
      const playerTeamMap = await buildPlayerTeamMap(gamesDir, gameIds);
      const reconstructed = reconstructDivisionRosters(div.meta, div.roster, playerTeamMap);
      if (reconstructed) {
        div.roster = { ...div.roster, records: reconstructed };
      }
    }
  }

  // Build team data from divisions
  const teamIndex = buildTeamIndexFromData(validDivisions, gameScores);

  // Write per-team files
  const teamsOutputDir = join(outputDir, 'teams');
  await mkdir(teamsOutputDir, { recursive: true });

  const teamIds = Object.keys(teamIndex);
  await Promise.all(
    teamIds.map(async (teamId) => {
      const teamDetail = teamIndex[teamId];
      const outputPath = join(teamsOutputDir, `${teamId}.json`);
      await writeFile(outputPath, JSON.stringify(teamDetail, null, 2), 'utf-8');
    })
  );

  return { teamCount: teamIds.length };
}

/**
 * Load game scores from game JSON files.
 *
 * @param {string} gamesDir - Path to games directory
 * @param {Set<string>} gameIds - Set of game IDs to load
 * @returns {Promise<Map<string, {homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number}>>}
 */
async function loadGameScores(gamesDir, gameIds) {
  const scores = new Map();
  const batchSize = 200;
  const ids = Array.from(gameIds);

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (gameId) => {
        try {
          const raw = await readFile(join(gamesDir, `${gameId}.json`), 'utf-8');
          const game = JSON.parse(raw);
          if (game.scoring && game.home && game.away) {
            return {
              gameId,
              homeTeamId: String(game.home.teamId),
              awayTeamId: String(game.away.teamId),
              homeScore: game.scoring.home.final,
              awayScore: game.scoring.away.final,
            };
          }
        } catch {
          // Game file missing or malformed — skip
        }
        return null;
      })
    );
    for (const r of results) {
      if (r) scores.set(r.gameId, r);
    }
  }

  return scores;
}

/**
 * Pure function that builds the team index from division data and game scores.
 * Extracted for testability without filesystem access.
 *
 * @param {Array} divisions - Array of division data objects
 * @param {Map} gameScores - Map of gameId → score data
 * @returns {Record<string, TeamDetail>}
 */
export function buildTeamIndexFromData(divisions, gameScores) {
  // teamId → { teamName, aliases: Set, seasons: [] }
  const teams = new Map();

  for (const div of divisions) {
    const { meta, schedule, roster } = div;
    const divId = String(meta.divId);
    const seasonName = meta.seasonName;
    const divisionLabel = meta.divisionLabel || '';

    if (!meta.teams) continue;

    // Compute W/L/T for each team in this division from game scores
    const teamRecords = computeDivisionRecords(meta.teams, schedule, gameScores);

    // Compute placement (rank by points descending)
    const placements = computePlacements(teamRecords);

    // Process each team in this division
    for (const [teamId, teamName] of Object.entries(meta.teams)) {
      if (!teams.has(teamId)) {
        teams.set(teamId, {
          teamId,
          teamName,
          aliasSet: new Set(),
          seasons: [],
        });
      }

      const team = teams.get(teamId);

      // Track aliases
      if (teamName !== team.teamName) {
        team.aliasSet.add(teamName);
      }
      // Also add the current primary name as alias if it was set earlier with a different name
      if (teamName !== team.teamName && !team.aliasSet.has(team.teamName)) {
        // Keep the most recent name as primary (we'll fix ordering later)
      }

      const record = teamRecords.get(teamId) || { w: 0, l: 0, t: 0 };
      const pts = record.w * 2 + record.t;
      const placement = placements.get(teamId) || 0;

      // Get roster snapshot for this team in this division
      const rosterSnapshot = extractRosterSnapshot(teamId, roster);

      team.seasons.push({
        seasonName,
        divId,
        divisionLabel,
        record: { w: record.w, l: record.l, t: record.t, pts, placement },
        roster: rosterSnapshot,
      });
    }
  }

  // Finalize: set primary name to most recent occurrence, build aliases array
  const result = {};
  for (const [teamId, team] of teams) {
    // Sort seasons by divId descending (most recent first)
    team.seasons.sort((a, b) => Number(b.divId) - Number(a.divId));

    // Most recent name is the primary name
    const mostRecentName = getMostRecentName(team, divisions);

    // Build aliases: all names used that differ from primary
    const allNames = new Set();
    allNames.add(team.teamName);
    for (const alias of team.aliasSet) {
      allNames.add(alias);
    }
    // Also collect names from schedule/meta across seasons
    for (const div of divisions) {
      if (div.meta.teams && div.meta.teams[teamId]) {
        allNames.add(div.meta.teams[teamId]);
      }
    }

    const aliases = Array.from(allNames).filter(n => n !== mostRecentName);

    result[teamId] = {
      teamId,
      teamName: mostRecentName,
      aliases,
      seasons: team.seasons,
    };
  }

  return result;
}

/**
 * Compute W/L/T records for each team in a division from game scores.
 */
function computeDivisionRecords(teams, schedule, gameScores) {
  const records = new Map();

  // Initialize records for all teams
  for (const teamId of Object.keys(teams)) {
    records.set(teamId, { w: 0, l: 0, t: 0 });
  }

  if (!schedule || !schedule.records) return records;

  for (const game of schedule.records) {
    if (!game.gameId) continue;

    const score = gameScores.get(String(game.gameId));
    if (!score) continue;

    // Use the team IDs from the game file's own score data, not the schedule.
    // The schedule's home/away can be swapped relative to the game file, which
    // would otherwise misattribute scores (flipping W/L).
    const homeId = score.homeTeamId;
    const awayId = score.awayTeamId;

    const homeRecord = records.get(homeId);
    const awayRecord = records.get(awayId);

    if (!homeRecord || !awayRecord) continue;

    if (score.homeScore > score.awayScore) {
      homeRecord.w++;
      awayRecord.l++;
    } else if (score.awayScore > score.homeScore) {
      awayRecord.w++;
      homeRecord.l++;
    } else {
      homeRecord.t++;
      awayRecord.t++;
    }
  }

  return records;
}

/**
 * Compute division placements ranked by points (W*2 + T) descending.
 */
function computePlacements(teamRecords) {
  const sorted = Array.from(teamRecords.entries())
    .map(([teamId, rec]) => ({ teamId, pts: rec.w * 2 + rec.t }))
    .sort((a, b) => b.pts - a.pts);

  const placements = new Map();
  for (let i = 0; i < sorted.length; i++) {
    placements.set(sorted[i].teamId, i + 1);
  }
  return placements;
}

/**
 * Extract roster snapshot (skaters and goalies) for a team from roster data.
 */
function extractRosterSnapshot(teamId, roster) {
  if (!roster || !roster.records || !roster.records[teamId]) {
    return { skaters: [], goalies: [] };
  }

  const teamRoster = roster.records[teamId];
  return {
    skaters: (teamRoster.skaters || []).map(s => ({
      name: s.name,
      number: s.number,
      gp: s.gp || 0,
      g: s.g || 0,
      a: s.a || 0,
      pts: s.pts || 0,
      pim: s.pim || 0,
    })),
    goalies: (teamRoster.goalies || []).map(g => ({
      name: g.name,
      number: g.number,
      gp: g.gp || 0,
      w: g.w || 0,
      l: g.l || 0,
      t: g.t || 0,
      gaa: g.gaa || '0.00',
      svpct: g.svpct || '0.000',
    })),
  };
}

/**
 * Get the most recent team name (from the division with the highest divId).
 */
function getMostRecentName(team, divisions) {
  let maxDivId = -1;
  let name = team.teamName;

  for (const div of divisions) {
    if (div.meta.teams && div.meta.teams[team.teamId]) {
      const divId = Number(div.meta.divId);
      if (divId > maxDivId) {
        maxDivId = divId;
        name = div.meta.teams[team.teamId];
      }
    }
  }

  return name;
}

/**
 * Standalone execution: build team index and write files.
 */
async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading archive data from: ${archiveDir}`);
  console.log(`Writing team files to: ${outputDir}/teams/`);

  const startTime = Date.now();
  const result = await buildTeamIndex(archiveDir, outputDir);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Team index built in ${elapsed}s`);
  console.log(`  Teams written: ${result.teamCount}`);
}

// Run standalone when executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('Team index build failed:', err);
    process.exit(1);
  });
}
