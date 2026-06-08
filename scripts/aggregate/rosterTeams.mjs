/**
 * Reconstruct per-team rosters from the single-bucket scraped roster data.
 *
 * The scraper stored every player in a division under one team key, but:
 *   1. Players are stored in team-contiguous order (jersey numbers ascend
 *      within a team, then reset at the next team).
 *   2. Game files (goals/penalties) tag each player with their correct team.
 *
 * Strategy:
 *   - Segment the flat skater/goalie lists into runs by detecting jersey-number
 *     resets (a number <= the previous number starts a new team segment).
 *   - Build a player-name → teamId map from all game events in the division.
 *   - Label each segment with a team via majority vote of its players' game
 *     mappings. Fall back to remaining unassigned teams in order.
 *   - Output rosters.byteam.json with records keyed by the real teamId.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/**
 * Normalize a player name for matching between roster ("Last, First") and
 * game-event ("#NN - First  Last") formats.
 * Returns a lowercase "first last" token string with non-letters stripped.
 */
function normalizeRosterName(name) {
  // Roster format: "Last, First" or "Last, First M"
  const parts = name.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const last = parts[0];
    const first = parts[1];
    return `${first} ${last}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  }
  return name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a game-event player name: "#62 - Mel  Marcelo" → "mel marcelo".
 */
function normalizeEventName(name) {
  // Strip leading "#NN - "
  const withoutNumber = name.replace(/^#\S+\s*-\s*/, '');
  return withoutNumber.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build a name → teamId map from a division's game files.
 */
export async function buildPlayerTeamMap(gamesDir, gameIds) {
  const map = new Map(); // normalizedName → teamId

  for (const gameId of gameIds) {
    let game;
    try {
      const raw = await readFile(join(gamesDir, `${gameId}.json`), 'utf-8');
      game = JSON.parse(raw);
    } catch {
      continue;
    }

    if (game.goals) {
      for (const goal of game.goals) {
        const teamId = goal.team?.teamId;
        if (!teamId) continue;
        for (const p of [goal.scorer, goal.assist1, goal.assist2]) {
          if (p) {
            const n = normalizeEventName(p);
            if (n) map.set(n, String(teamId));
          }
        }
      }
    }

    if (game.penalties) {
      for (const pen of game.penalties) {
        const teamId = pen.team?.teamId;
        if (teamId && pen.player) {
          const n = normalizeEventName(pen.player);
          if (n) map.set(n, String(teamId));
        }
      }
    }
  }

  return map;
}

/**
 * Segment a list of players into runs by jersey-number reset.
 * A new segment starts when the current number is <= the previous number.
 * Players with non-numeric numbers are attached to the current segment.
 */
function segmentByJerseyReset(players) {
  const segments = [];
  let current = [];
  let prevNum = -1;

  for (const player of players) {
    const num = parseInt(player.number, 10);
    const validNum = !Number.isNaN(num);

    if (validNum && num <= prevNum && current.length > 0) {
      segments.push(current);
      current = [];
    }

    current.push(player);
    if (validNum) prevNum = num;
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Assign a teamId to a segment via majority vote of its players' game mappings.
 * Returns the winning teamId or null if no players matched.
 */
function voteSegmentTeam(segment, playerTeamMap) {
  const votes = new Map();
  for (const player of segment) {
    const n = normalizeRosterName(player.name);
    const teamId = playerTeamMap.get(n);
    if (teamId) {
      votes.set(teamId, (votes.get(teamId) || 0) + 1);
    }
  }

  let best = null;
  let bestCount = 0;
  for (const [teamId, count] of votes) {
    if (count > bestCount) {
      bestCount = count;
      best = teamId;
    }
  }
  return best;
}

/**
 * Reconstruct per-team records for one division.
 * Returns a records object keyed by teamId, or null if reconstruction
 * isn't needed/possible.
 */
export function reconstructDivisionRosters(meta, roster, playerTeamMap) {
  const recordKeys = Object.keys(roster.records || {});
  const metaTeamCount = Object.keys(meta.teams || {}).length;

  // Only reconstruct when it's a single-bucket dump across multiple teams
  if (recordKeys.length !== 1 || metaTeamCount <= 1) {
    return null;
  }

  const bucket = roster.records[recordKeys[0]];
  const skaters = bucket.skaters || [];
  const goalies = bucket.goalies || [];

  const skaterSegments = segmentByJerseyReset(skaters);
  const goalieSegments = segmentByJerseyReset(goalies);

  // Build the output records object
  const records = {};
  const allTeamIds = Object.keys(meta.teams);
  const usedTeamIds = new Set();

  // Assign skater segments by vote — skaters appear frequently in game events
  // (goals/penalties), so their team votes are reliable.
  const skaterAssignments = skaterSegments.map(seg => voteSegmentTeam(seg, playerTeamMap));

  // Resolve conflicts/unassigned: fill from remaining team IDs in meta order
  function resolveAssignments(segments, assignments) {
    const result = [];
    const localUsed = new Set();
    for (let i = 0; i < segments.length; i++) {
      let teamId = assignments[i];
      // If voted team already used in this segment list, or no vote, defer
      if (teamId && !localUsed.has(teamId)) {
        result.push(teamId);
        localUsed.add(teamId);
      } else {
        result.push(null); // resolve later
      }
    }
    // Fill nulls with remaining unused teams in meta order
    const remaining = allTeamIds.filter(id => !localUsed.has(id));
    let ri = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === null) {
        result[i] = remaining[ri] || `unknown-${i}`;
        if (remaining[ri]) ri++;
      }
    }
    return result;
  }

  const finalSkaterTeams = resolveAssignments(skaterSegments, skaterAssignments);

  // Goalies are listed in the SAME team order as skaters in the source data.
  // Goalie game-event voting is unreliable (goalies rarely score or take
  // penalties, and surnames collide with skaters), so when the segment counts
  // match we align goalies positionally to the skater team assignments.
  let finalGoalieTeams;
  if (goalieSegments.length === skaterSegments.length) {
    finalGoalieTeams = finalSkaterTeams.slice();
  } else {
    // Fallback: vote independently, then fill remaining teams in order.
    const goalieAssignments = goalieSegments.map(seg => voteSegmentTeam(seg, playerTeamMap));
    finalGoalieTeams = resolveAssignments(goalieSegments, goalieAssignments);
  }

  // Initialize records for all known teams
  for (const teamId of allTeamIds) {
    records[teamId] = {
      skaters: [],
      goalies: [],
    };
  }

  // Place skater segments
  for (let i = 0; i < skaterSegments.length; i++) {
    const teamId = finalSkaterTeams[i];
    if (!records[teamId]) records[teamId] = { skaters: [], goalies: [] };
    const teamName = meta.teams[teamId] || `Team ${teamId}`;
    for (const player of skaterSegments[i]) {
      records[teamId].skaters.push({
        ...player,
        team: { teamId, name: teamName },
      });
    }
    usedTeamIds.add(teamId);
  }

  // Place goalie segments
  for (let i = 0; i < goalieSegments.length; i++) {
    const teamId = finalGoalieTeams[i];
    if (!records[teamId]) records[teamId] = { skaters: [], goalies: [] };
    const teamName = meta.teams[teamId] || `Team ${teamId}`;
    for (const player of goalieSegments[i]) {
      records[teamId].goalies.push({
        ...player,
        team: { teamId, name: teamName },
      });
    }
  }

  return records;
}

/**
 * Build reconstructed per-team rosters for all divisions and write
 * rosters.byteam.json into each division's output folder.
 */
export async function buildRosterTeams(archiveRoot, outputDir) {
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

    if (!meta.teams || !roster.records) continue;

    const gameIds = schedule?.records
      ? schedule.records.filter(g => g.gameId).map(g => g.gameId)
      : [];

    const playerTeamMap = await buildPlayerTeamMap(gamesDir, gameIds);
    const records = reconstructDivisionRosters(meta, roster, playerTeamMap);

    if (!records) continue;

    const outDir = join(outputDivisionsDir, divId);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, 'rosters.byteam.json'),
      JSON.stringify({ divId, mode: 'regular', kind: 'rosters', records }, null, 2),
      'utf-8'
    );
    count++;
  }

  console.log(`    ${count} division rosters reconstructed by team`);
  return count;
}
