/**
 * Goalie Career Index Builder
 *
 * Reads all roster files from the archive, resolves goalie identities using
 * Jaro-Winkler name clustering (same algorithm as buildGoalieProfiles),
 * computes career totals (GP, W, L, T, GA, SA, SV, SO, GAA, SV%),
 * and writes:
 *   - public/data/all-goalies.json (index of all goalies with career totals)
 *   - public/data/goalies/{id}.json (per-goalie detail with season-by-season breakdowns)
 *
 * Requirements: 3.3
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeName, jaroWinkler } from '../../src/utils/playerIdentity.mjs';
import { buildPlayerTeamMap, reconstructDivisionRosters } from './rosterTeams.mjs';
import { loadPlayerIdentityOverrides, isNeverMerge, resolveAlwaysMergeCanonical } from './playerIdentityOverrides.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SIMILARITY_THRESHOLD = 0.88;

/**
 * Generate a stable ID from a canonical name using MD5 hash (first 10 hex chars).
 */
function generateId(canonicalName) {
  return createHash('md5').update(canonicalName).digest('hex').slice(0, 10);
}

/**
 * Read all roster files from the archive and extract goalie entries with full metadata.
 *
 * @param {string} archiveDir - Path to archive/divisions directory
 * @returns {Promise<Array>} Flat array of enriched goalie entries
 */
async function readAllGoalieEntries(archiveDir, gamesDir) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  const allGoalies = [];

  for (const dir of divDirs) {
    const divPath = join(archiveDir, dir.name);
    const divId = dir.name;

    // Read meta.json for season context
    let meta;
    try {
      const metaRaw = await readFile(join(divPath, 'meta.json'), 'utf-8');
      meta = JSON.parse(metaRaw);
    } catch {
      continue; // skip divisions without valid meta
    }

    const { seasonName, divisionLabel } = meta;
    if (!seasonName) continue;

    // Build player→team map from game data to reconstruct per-team rosters
    // (raw roster files dump every player under a single team key).
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

    // Read regular and playoff roster files
    const rosterFiles = ['rosters.regular.json', 'rosters.playoff.json'];

    for (const rosterFile of rosterFiles) {
      let rosterData;
      try {
        const raw = await readFile(join(divPath, rosterFile), 'utf-8');
        rosterData = JSON.parse(raw);
      } catch {
        continue; // file doesn't exist or is malformed
      }

      let records = rosterData.records || rosterData.teams || {};
      const recordKeys = Object.keys(records);
      const metaTeamCount = Object.keys(meta.teams || {}).length;
      if (recordKeys.length === 1 && metaTeamCount > 1) {
        const reconstructed = reconstructDivisionRosters(meta, rosterData, playerTeamMap);
        if (reconstructed) records = reconstructed;
      }

      for (const [teamId, teamData] of Object.entries(records)) {
        const goalies = teamData.goalies || [];

        for (const g of goalies) {
          if (!g.name || /^substit/i.test(g.name)) continue;

          allGoalies.push({
            name: g.name,
            number: g.number || '',
            gp: g.gp || 0,
            w: g.w || 0,
            l: g.l || 0,
            t: g.t || 0,
            ga: g.ga || 0,
            sa: g.sa || 0,
            sv: g.sv || 0,
            so: g.so || 0,
            gaa: g.gaa || '',
            svpct: g.svpct || '',
            pim: g.pim || 0,
            // Metadata for season breakdown
            seasonName,
            seasonId: `${divId}-${rosterData.mode || 'regular'}`,
            divId,
            divisionLabel: divisionLabel || '',
            teamId: g.team?.teamId || teamId,
            teamName: g.team?.name || '',
          });
        }
      }
    }
  }

  return allGoalies;
}

/**
 * Cluster goalie entries by name similarity using Jaro-Winkler.
 * Same algorithm as buildGoalieProfiles but preserves full metadata.
 *
 * @param {Array} entries
 * @param {object} [overrides] - result of loadPlayerIdentityOverrides()
 */
function clusterGoalies(entries, overrides) {
  const clusters = []; // [{canonical, entries[]}]

  for (const entry of entries) {
    let norm = normalizeName(entry.name);
    if (overrides) norm = resolveAlwaysMergeCanonical(overrides, norm);
    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      if (overrides && isNeverMerge(overrides, norm, cluster.canonical)) continue;
      if (norm === cluster.canonical) {
        bestScore = 1;
        bestCluster = cluster;
        break;
      }
      const score = jaroWinkler(norm, cluster.canonical);
      if (score > SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.entries.push(entry);
    } else {
      clusters.push({ canonical: norm, entries: [entry] });
    }
  }

  return clusters;
}

/**
 * Build profiles from clusters with career totals and season breakdowns.
 */
function buildProfiles(clusters) {
  return clusters
    .filter(c => c.entries.length > 0)
    .map(c => {
      // Pick display name: most common
      const nameCounts = {};
      c.entries.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1; });
      const displayName = Object.entries(nameCounts)
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];

      // Pick jersey number: most common non-empty
      const numCounts = {};
      c.entries.forEach(e => {
        const n = e.number?.toString().replace(/\D/g, '');
        if (n) numCounts[n] = (numCounts[n] || 0) + 1;
      });
      const number = Object.entries(numCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

      // Aggregate career totals
      const totals = { gp: 0, w: 0, l: 0, t: 0, ga: 0, sa: 0, sv: 0, so: 0 };
      c.entries.forEach(e => {
        totals.gp += e.gp || 0;
        totals.w  += e.w  || 0;
        totals.l  += e.l  || 0;
        totals.t  += e.t  || 0;
        totals.ga += e.ga || 0;
        totals.sa += e.sa || 0;
        totals.sv += e.sv || 0;
        totals.so += e.so || 0;
      });

      // Compute derived stats
      totals.gaa = totals.gp > 0 ? (totals.ga / totals.gp).toFixed(2) : '—';
      totals.svpct = totals.sa > 0 ? (totals.sv / totals.sa).toFixed(3) : '—';

      // Season-by-season breakdown with full metadata (deduplicated by seasonId)
      const seen = new Set();
      const seasons = c.entries
        .filter(e => {
          const key = e.seasonId || e.seasonName;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(e => ({
          seasonName: e.seasonName,
          divId: e.divId,
          divisionLabel: e.divisionLabel,
          teamId: e.teamId,
          teamName: e.teamName,
          number: e.number || number,
          stats: {
            gp: e.gp || 0,
            w: e.w || 0,
            l: e.l || 0,
            t: e.t || 0,
            ga: e.ga || 0,
            sa: e.sa || 0,
            sv: e.sv || 0,
            so: e.so || 0,
            gaa: e.gaa || '',
            svpct: e.svpct || '',
          },
        }))
        .sort((a, b) => (b.seasonName || '').localeCompare(a.seasonName || ''));

      return {
        canonical: c.canonical,
        displayName,
        number,
        totals,
        seasons,
      };
    })
    .sort((a, b) => b.totals.w - a.totals.w);
}

/**
 * Build the goalie index and per-goalie detail files.
 *
 * @param {string} archiveDir - Path to archive/divisions directory
 * @param {string} outputDir - Path to public/data directory
 * @returns {Promise<Array>} The all-goalies index array
 */
export async function buildGoalieIndex(archiveDir, outputDir) {
  console.log('Building goalie index...');

  // archiveDir points to archive/divisions/ — games live alongside it
  const gamesDir = resolve(archiveDir, '..', 'games');

  const allEntries = await readAllGoalieEntries(archiveDir, gamesDir);
  console.log(`  Found ${allEntries.length} goalie entries across all divisions`);

  const overrides = await loadPlayerIdentityOverrides(archiveDir);
  const clusters = clusterGoalies(allEntries, overrides);
  const profiles = buildProfiles(clusters);

  // Create output directories
  const goaliesDir = join(outputDir, 'goalies');
  await mkdir(goaliesDir, { recursive: true });

  const index = [];

  for (const profile of profiles) {
    const id = generateId(profile.canonical);

    // Index entry (flat totals for the all-goalies list)
    index.push({
      id,
      displayName: profile.displayName,
      number: profile.number,
      totals: profile.totals,
    });

    // Per-goalie detail file
    const detail = {
      id,
      displayName: profile.displayName,
      number: profile.number,
      totals: profile.totals,
      seasons: profile.seasons,
    };

    await writeFile(join(goaliesDir, `${id}.json`), JSON.stringify(detail, null, 2), 'utf-8');
  }

  // Write all-goalies index
  await writeFile(join(outputDir, 'all-goalies.json'), JSON.stringify(index, null, 2), 'utf-8');

  console.log(`  ✓ all-goalies.json: ${index.length} goalies`);
  console.log(`  ✓ goalies/{id}.json: ${index.length} detail files`);

  return index;
}

// ── Standalone execution ────────────────────────────────────────────────────

async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive', 'divisions');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading goalie data from: ${archiveDir}`);
  console.log(`Writing output to: ${outputDir}`);

  const startTime = Date.now();
  await buildGoalieIndex(archiveDir, outputDir);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nGoalie index build completed in ${elapsed}s`);
}

// Run standalone when executed directly
const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main().catch(err => {
    console.error('Goalie index build failed:', err);
    process.exit(1);
  });
}
