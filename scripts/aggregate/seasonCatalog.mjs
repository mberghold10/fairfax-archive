/**
 * Season Catalog Builder
 *
 * Reads all archive/divisions/{id}/meta.json files and produces
 * public/data/season-catalog.json mapping each season name to its
 * division IDs, division labels, and team lists.
 *
 * Ordered chronologically — most recent first (higher division IDs = more recent).
 * Handles arbitrary season names and division ID ranges without hardcoding.
 *
 * Requirements: 3.1, 14.1, 14.2, 14.3
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.url.startsWith('file:')
  ? fileURLToPath(new URL('.', import.meta.url))
  : '.';

/**
 * Builds the season catalog from an archive directory.
 *
 * @param {string} archiveDir - Path to the archive/divisions directory
 * @returns {Promise<{seasons: Array}>} The season catalog object
 */
export async function buildSeasonCatalog(archiveDir) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  // Read all meta.json files
  const metaResults = await Promise.all(
    divDirs.map(async (dir) => {
      const metaPath = join(archiveDir, dir.name, 'meta.json');
      try {
        const raw = await readFile(metaPath, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`Warning: Could not read meta.json for division ${dir.name}: ${err.message}`);
        return null;
      }
    })
  );

  // Filter out failed reads
  const metas = metaResults.filter(m => m !== null);

  return buildCatalogFromMetas(metas);
}

/**
 * Pure function that builds the season catalog from an array of parsed meta objects.
 * This is the core logic extracted for testability without filesystem access.
 *
 * @param {Array<{seasonName: string, divisionLabel?: string, teams?: Record<string, string>, divId: string}>} metas
 * @returns {{seasons: Array}} The season catalog object
 */
export function buildCatalogFromMetas(metas) {
  // Group divisions by season name
  const seasonMap = new Map();

  for (const meta of metas) {
    const { seasonName, divisionLabel, teams, divId } = meta;
    if (!seasonName || !divId) {
      continue;
    }

    if (!seasonMap.has(seasonName)) {
      seasonMap.set(seasonName, []);
    }

    seasonMap.get(seasonName).push({
      divId: String(divId),
      divisionLabel: divisionLabel || '',
      teams: teams || {}
    });
  }

  // Sort divisions within each season by divId ascending (for consistent ordering)
  for (const divisions of seasonMap.values()) {
    divisions.sort((a, b) => Number(a.divId) - Number(b.divId));
  }

  // Convert to array of seasons, ordered by max divId descending (most recent first)
  const seasons = Array.from(seasonMap.entries())
    .map(([seasonName, divisions]) => ({
      seasonName,
      divisions,
      _maxDivId: Math.max(...divisions.map(d => Number(d.divId)))
    }))
    .sort((a, b) => b._maxDivId - a._maxDivId)
    .map(({ seasonName, divisions }) => ({ seasonName, divisions }));

  return { seasons };
}

/**
 * Standalone execution: build the catalog and write to public/data/season-catalog.json
 */
async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive', 'divisions');
  const outputDir = resolve(projectRoot, 'public', 'data');
  const outputPath = join(outputDir, 'season-catalog.json');

  console.log(`Reading division metadata from: ${archiveDir}`);

  const catalog = await buildSeasonCatalog(archiveDir);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(catalog, null, 2), 'utf-8');

  console.log(`Season catalog written to: ${outputPath}`);
  console.log(`  Seasons: ${catalog.seasons.length}`);
  console.log(`  Total divisions: ${catalog.seasons.reduce((sum, s) => sum + s.divisions.length, 0)}`);
}

// Run standalone when executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('Season catalog build failed:', err);
    process.exit(1);
  });
}
