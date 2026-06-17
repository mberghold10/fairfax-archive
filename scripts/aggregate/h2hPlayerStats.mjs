/**
 * Head-to-Head Player Stats Builder
 *
 * For every matchup that has at least one game with a box score file,
 * computes per-player goals, assists, points, and PIM against that opponent.
 * Writes per-matchup files at:
 *   public/data/h2h-players/{key}.json
 *
 * The key format matches head-to-head.json: "{smallerId}-{largerId}"
 * (same as matchupKey() in headToHead.mjs)
 *
 * Only matchups that have game files are written (RR-only matchups lack files).
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BATCH_SIZE = 100;

/**
 * Parse "#5 - Chris  Maroon" → "Maroon, Chris" (Last, First)
 */
function parseEventName(raw) {
  if (!raw) return null;
  const name = raw.replace(/^#\S+\s*-\s*/, '').replace(/\s+/g, ' ').trim();
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

function toTeamSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function matchupKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export async function buildH2HPlayerStats(archiveDir, outputDir) {
  const gamesDir = resolve(archiveDir, 'games');
  const h2hPlayersDir = join(outputDir, 'h2h-players');
  await mkdir(h2hPlayersDir, { recursive: true });

  // Load existing H2H index to know which matchups exist
  const h2hPath = join(outputDir, 'head-to-head.json');
  let h2hData;
  try {
    h2hData = JSON.parse(await readFile(h2hPath, 'utf-8'));
  } catch {
    console.warn('  No head-to-head.json found — skipping h2h player stats');
    return 0;
  }

  const matchups = h2hData.matchups;
  const allKeys = Object.keys(matchups);

  // For each matchup, collect all gameIds and compute player stats
  let written = 0;

  // Process in batches to avoid too many open file handles
  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batch = allKeys.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (key) => {
      const matchup = matchups[key];
      const gameIds = matchup.games.map(g => g.gameId).filter(Boolean);
      if (gameIds.length === 0) return;

      // Player stats keyed by team SLUG (canonical) so multi-season stats accumulate
      const statsBySlug = {};

      for (const gameId of gameIds) {
        let game;
        try {
          game = JSON.parse(await readFile(join(gamesDir, `${gameId}.json`), 'utf-8'));
        } catch {
          continue;
        }

        for (const goal of (game.goals || [])) {
          const teamName = goal.team?.name || '';
          const slug = toTeamSlug(teamName);
          if (!slug) continue;
          if (!statsBySlug[slug]) statsBySlug[slug] = { name: teamName, players: {} };
          const addPlayer = (raw) => {
            const n = parseEventName(raw);
            if (!n) return;
            if (!statsBySlug[slug].players[n]) statsBySlug[slug].players[n] = { g: 0, a: 0, pts: 0, pim: 0 };
            statsBySlug[slug].players[n].g++;
            statsBySlug[slug].players[n].pts++;
          };
          addPlayer(goal.scorer);
          for (const a of [goal.assist1, goal.assist2]) {
            if (!a) continue;
            const n = parseEventName(a);
            if (!n) return;
            if (!statsBySlug[slug].players[n]) statsBySlug[slug].players[n] = { g: 0, a: 0, pts: 0, pim: 0 };
            statsBySlug[slug].players[n].a++;
            statsBySlug[slug].players[n].pts++;
          }
        }

        for (const pen of (game.penalties || [])) {
          const teamName = pen.team?.name || '';
          const slug = toTeamSlug(teamName);
          if (!slug || !pen.player) continue;
          if (!statsBySlug[slug]) statsBySlug[slug] = { name: teamName, players: {} };
          const n = parseEventName(pen.player);
          if (n) {
            if (!statsBySlug[slug].players[n]) statsBySlug[slug].players[n] = { g: 0, a: 0, pts: 0, pim: 0 };
            statsBySlug[slug].players[n].pim += pen.pim || 2;
          }
        }
      }

      if (Object.keys(statsBySlug).length === 0) return;

      // Convert to sorted arrays, keyed by slug
      const result = {};
      for (const [slug, { players }] of Object.entries(statsBySlug)) {
        result[slug] = Object.entries(players)
          .map(([name, stats]) => ({ name, ...stats }))
          .sort((a, b) => b.pts - a.pts || b.g - a.g);
      }

      await writeFile(
        join(h2hPlayersDir, `${key}.json`),
        JSON.stringify({ key, players: result }),
        'utf-8'
      );
      written++;
    }));
  }

  console.log(`    ${written} matchup player stat files written`);
  return written;
}
