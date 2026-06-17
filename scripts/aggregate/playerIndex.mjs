/**
 * Skater Career Index Builder
 *
 * Reads all roster files from the archive, resolves player identities using
 * the Player Identity Module (Jaro-Winkler clustering), computes career totals
 * (GP, G, A, PTS, PPG, PPA, SHG, SHA, PIM), and writes:
 *   - public/data/all-players.json (PlayerIndexEntry[])
 *   - public/data/players/{id}.json (PlayerDetail per player)
 *
 * Requirements: 3.2, 3.4, 6.6
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { jaroWinkler, normalizeName } from '../../src/utils/playerIdentity.mjs';
import { buildPlayerTeamMap, reconstructDivisionRosters } from './rosterTeams.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SIMILARITY_THRESHOLD = 0.88;

/**
 * Generate a stable ID from a canonical (normalized) player name.
 * Uses first 12 chars of a SHA-256 hex digest for reasonable uniqueness.
 */
function generatePlayerId(canonicalName) {
  return createHash('sha256').update(canonicalName).digest('hex').slice(0, 12);
}

/**
 * Reads all roster files from the archive and collects enriched skater entries.
 *
 * @param {string} archiveDir - Path to archive/divisions/
 * @param {string} gamesDir - Path to archive/games/
 * @returns {Promise<Array>} Flat array of skater entries with metadata
 */
async function collectSkaterEntries(archiveDir, gamesDir) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  const allSkaters = [];

  for (const dir of divDirs) {
    const divPath = join(archiveDir, dir.name);
    const divId = dir.name;

    // Read meta.json for divisionLabel and seasonName
    let meta;
    try {
      const metaRaw = await readFile(join(divPath, 'meta.json'), 'utf-8');
      meta = JSON.parse(metaRaw);
    } catch {
      console.warn(`  ⚠ Skipping division ${divId}: could not read meta.json`);
      continue;
    }

    const divisionLabel = meta.divisionLabel || '';
    const seasonName = meta.seasonName || '';

    // Load the schedule once so we can reconstruct per-team rosters from game
    // data (the raw roster files dump all players under a single team key).
    let schedule = null;
    try {
      schedule = JSON.parse(await readFile(join(divPath, 'schedule.regular.json'), 'utf-8'));
    } catch {
      schedule = null;
    }
    const gameIds = schedule?.records
      ? schedule.records.filter(g => g.gameId).map(g => g.gameId)
      : [];
    const playerTeamMap = await buildPlayerTeamMap(gamesDir, gameIds);

    // Process both regular and playoff roster files
    for (const mode of ['regular', 'playoff']) {
      const rosterPath = join(divPath, `rosters.${mode}.json`);
      let rosterData;
      try {
        const raw = await readFile(rosterPath, 'utf-8');
        rosterData = JSON.parse(raw);
      } catch {
        // Playoff rosters may not exist — that's fine
        continue;
      }

      // Reconstruct per-team records when the data is a single-bucket dump so
      // each player is attributed to the correct team.
      let records = rosterData.records || {};
      const recordKeys = Object.keys(records);
      const metaTeamCount = Object.keys(meta.teams || {}).length;
      if (recordKeys.length === 1 && metaTeamCount > 1) {
        const reconstructed = reconstructDivisionRosters(meta, rosterData, playerTeamMap);
        if (reconstructed) records = reconstructed;
      }

      for (const [teamId, teamData] of Object.entries(records)) {
        for (const skater of (teamData.skaters || [])) {
          allSkaters.push({
            name: skater.name,
            number: skater.number,
            gp: skater.gp || 0,
            g: skater.g || 0,
            a: skater.a || 0,
            pts: skater.pts || 0,
            ppg: skater.ppg || 0,
            ppa: skater.ppa || 0,
            shg: skater.shg || 0,
            sha: skater.sha || 0,
            pim: skater.pim || 0,
            // Metadata for season breakdowns
            divId,
            divisionLabel,
            seasonName: skater.seasonName || seasonName,
            teamId: skater.team?.teamId || teamId,
            teamName: skater.team?.name || '',
            mode
          });
        }
      }
    }
  }

  return allSkaters;
}

/**
 * Generate blocking keys for a normalized name to reduce comparison space.
 * Returns multiple keys to catch near-matches (first 2 and 3 chars of last name).
 */
function blockingKeys(normalizedName) {
  const commaIdx = normalizedName.indexOf(',');
  const lastName = commaIdx > 0 ? normalizedName.slice(0, commaIdx).trim() : normalizedName.split(' ')[0];
  const keys = [];
  if (lastName.length >= 2) keys.push(lastName.slice(0, 2));
  if (lastName.length >= 3) keys.push(lastName.slice(0, 3));
  return keys;
}

/**
 * Cluster skater entries by name similarity + jersey number.
 * Same algorithm as buildPlayerProfiles but preserves full metadata per entry.
 * Uses blocking to avoid O(n*m) full comparisons.
 *
 * @param {Array} entries - Flat array of enriched skater entries
 * @returns {Array} Array of cluster objects
 */
function clusterSkaters(entries) {
  const clusters = []; // [{canonical, displayName, number, entries[]}]
  // Block index: maps blocking key → set of cluster indices
  const blockIndex = new Map();

  for (const entry of entries) {
    if (!entry.name || /^substit/i.test(entry.name)) continue;

    const norm = normalizeName(entry.name);
    const num = entry.number?.toString().replace(/\D/g, '') || '';
    const bKeys = blockingKeys(norm);

    // Collect candidate clusters from all relevant blocks
    const candidateIndices = new Set();
    for (const bk of bKeys) {
      if (blockIndex.has(bk)) {
        for (const idx of blockIndex.get(bk)) candidateIndices.add(idx);
      }
    }

    // Find best matching cluster among candidates
    let bestCluster = null;
    let bestScore = 0;

    for (const idx of candidateIndices) {
      const cluster = clusters[idx];
      const nameSim = jaroWinkler(norm, cluster.canonical);
      const numBoost = (num && cluster.number && num === cluster.number) ? 0.05 : 0;
      const score = nameSim + numBoost;
      if (score > SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.entries.push(entry);
      if (!bestCluster.number && num) bestCluster.number = num;
    } else {
      const newIdx = clusters.length;
      clusters.push({
        canonical: norm,
        displayName: entry.name,
        number: num,
        entries: [entry]
      });
      // Register in block index under all blocking keys
      for (const bk of bKeys) {
        if (!blockIndex.has(bk)) blockIndex.set(bk, []);
        blockIndex.get(bk).push(newIdx);
      }
    }
  }

  return clusters;
}

/**
 * Build the player index and per-player detail files.
 *
 * @param {string} archiveDir - Path to archive/divisions/
 * @param {string} outputDir - Path to public/data/
 * @returns {Promise<Array>} The all-players index array (PlayerIndexEntry[])
 */
export async function buildPlayerIndex(archiveDir, outputDir) {
  console.log('  Building skater career index...');

  // archiveDir points to archive/divisions/ — games live alongside it
  const gamesDir = resolve(archiveDir, '..', 'games');

  // Collect all skater entries across all divisions
  const allEntries = await collectSkaterEntries(archiveDir, gamesDir);
  console.log(`    Found ${allEntries.length} skater entries`);

  // Cluster by identity
  const clusters = clusterSkaters(allEntries);
  console.log(`    Resolved ${clusters.length} unique player profiles`);

  // Build output
  const playersDir = join(outputDir, 'players');
  await mkdir(playersDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const allPlayers = [];

  for (const cluster of clusters) {
    if (cluster.entries.length === 0) continue;

    // Pick display name: most common occurrence
    const nameCounts = {};
    cluster.entries.forEach(e => {
      nameCounts[e.name] = (nameCounts[e.name] || 0) + 1;
    });
    const displayName = Object.entries(nameCounts)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];

    // Pick jersey number: most common non-empty
    const numCounts = {};
    cluster.entries.forEach(e => {
      const n = e.number?.toString().replace(/\D/g, '');
      if (n) numCounts[n] = (numCounts[n] || 0) + 1;
    });
    const number = Object.entries(numCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Compute career totals
    const totals = { gp: 0, g: 0, a: 0, pts: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, pim: 0 };
    for (const entry of cluster.entries) {
      totals.gp += entry.gp || 0;
      totals.g += entry.g || 0;
      totals.a += entry.a || 0;
      totals.ppg += entry.ppg || 0;
      totals.ppa += entry.ppa || 0;
      totals.shg += entry.shg || 0;
      totals.sha += entry.sha || 0;
      totals.pim += entry.pim || 0;
    }
    totals.pts = totals.g + totals.a;

    // Build season-by-season breakdowns
    // Combine regular + playoff stats into one entry per divId + teamId
    const seasonMap = new Map();
    for (const entry of cluster.entries) {
      const key = `${entry.divId}-${entry.teamId}`;
      if (!seasonMap.has(key)) {
        seasonMap.set(key, {
          seasonName: entry.seasonName || '',
          divId: String(entry.divId || ''),
          divisionLabel: entry.divisionLabel || '',
          teamId: String(entry.teamId || ''),
          teamName: entry.teamName || '',
          number: entry.number?.toString() || number,
          stats: { gp: 0, g: 0, a: 0, pts: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, pim: 0 }
        });
      }
      const season = seasonMap.get(key);
      season.stats.gp += entry.gp || 0;
      season.stats.g += entry.g || 0;
      season.stats.a += entry.a || 0;
      season.stats.ppg += entry.ppg || 0;
      season.stats.ppa += entry.ppa || 0;
      season.stats.shg += entry.shg || 0;
      season.stats.sha += entry.sha || 0;
      season.stats.pim += entry.pim || 0;
    }
    // Recalculate pts for each season
    for (const season of seasonMap.values()) {
      season.stats.pts = season.stats.g + season.stats.a;
    }

    const seasons = Array.from(seasonMap.values());

    // Sort seasons by divId descending (higher = more recent)
    seasons.sort((a, b) => Number(b.divId) - Number(a.divId));

    const id = generatePlayerId(cluster.canonical);

    const indexEntry = {
      id,
      displayName,
      number,
      totals
    };

    const detailEntry = {
      id,
      displayName,
      number,
      totals,
      seasons
    };

    allPlayers.push(indexEntry);

    // Write per-player detail file
    await writeFile(
      join(playersDir, `${id}.json`),
      JSON.stringify(detailEntry, null, 2),
      'utf-8'
    );
  }

  // Sort all-players by points descending
  allPlayers.sort((a, b) => b.totals.pts - a.totals.pts);

  // Write all-players index
  await writeFile(
    join(outputDir, 'all-players.json'),
    JSON.stringify(allPlayers, null, 2),
    'utf-8'
  );

  console.log(`    ✓ all-players.json: ${allPlayers.length} players`);
  console.log(`    ✓ players/*.json: ${allPlayers.length} detail files`);

  return allPlayers;
}

/**
 * Standalone execution
 */
async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive', 'divisions');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading roster data from: ${archiveDir}`);

  const result = await buildPlayerIndex(archiveDir, outputDir);
  console.log(`\nDone. ${result.length} players indexed.`);
}

// Run standalone when executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('Player index build failed:', err);
    process.exit(1);
  });
}
