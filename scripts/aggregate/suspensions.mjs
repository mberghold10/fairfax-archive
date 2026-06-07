/**
 * Suspensions Index Builder
 *
 * Reads all archive/divisions/{id}/suspensions.json files, collates entries
 * with player name, team, season, division, rule, games affected,
 * corroboration flag, and discrepancy flag; writes public/data/suspensions.json.
 *
 * Requirements: 10.1, 10.2, 10.3
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.url.startsWith('file:')
  ? fileURLToPath(new URL('.', import.meta.url))
  : '.';

/**
 * Builds the suspensions index from an archive directory.
 *
 * @param {string} archiveDir - Path to the archive/divisions directory
 * @param {string} outputDir - Path to the output directory (public/data/)
 * @returns {Promise<{suspensions: Array}>} The suspensions index object
 */
export async function buildSuspensions(archiveDir, outputDir) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const divDirs = entries.filter(e => e.isDirectory());

  // Read all suspensions.json files
  const results = await Promise.all(
    divDirs.map(async (dir) => {
      const suspPath = join(archiveDir, dir.name, 'suspensions.json');
      try {
        const raw = await readFile(suspPath, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        // Not all divisions have suspensions.json — this is expected
        if (err.code === 'ENOENT') return null;
        console.warn(`Warning: Could not read suspensions.json for division ${dir.name}: ${err.message}`);
        return null;
      }
    })
  );

  // Collate all suspension entries
  const index = collateSuspensions(results.filter(r => r !== null));

  // Write output
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'suspensions.json');
  await writeFile(outputPath, JSON.stringify(index, null, 2), 'utf-8');

  console.log(`Suspensions index written to: ${outputPath}`);
  console.log(`  Total suspensions: ${index.suspensions.length}`);

  return index;
}

/**
 * Pure function that collates suspension entries from parsed division files.
 * Extracts the fields specified by the SuspensionEntry interface.
 *
 * @param {Array<{divId: string, suspensions: Array}>} divisionFiles - Parsed suspensions.json contents
 * @returns {{suspensions: Array}} The suspensions index object
 */
export function collateSuspensions(divisionFiles) {
  const suspensions = [];

  for (const file of divisionFiles) {
    if (!file.suspensions || !Array.isArray(file.suspensions)) {
      continue;
    }

    for (const entry of file.suspensions) {
      suspensions.push({
        playerKey: entry.playerKey || '',
        playerName: entry.playerName || '',
        team: entry.team || { teamId: '', name: '' },
        divId: typeof entry.divId === 'string' ? Number(entry.divId) : (entry.divId || 0),
        seasonName: entry.seasonName || '',
        rule: entry.rule || '',
        appliesToGames: Array.isArray(entry.appliesToGames) ? entry.appliesToGames : [],
        corroboratedByRosterColumn: Boolean(entry.corroboratedByRosterColumn),
        discrepancy: Boolean(entry.discrepancy)
      });
    }
  }

  return { suspensions };
}

/**
 * Standalone execution: build the suspensions index and write output.
 */
async function main() {
  const projectRoot = resolve(__dirname, '..', '..');
  const archiveDir = resolve(projectRoot, 'archive', 'divisions');
  const outputDir = resolve(projectRoot, 'public', 'data');

  console.log(`Reading suspension data from: ${archiveDir}`);

  await buildSuspensions(archiveDir, outputDir);
}

// Run standalone when executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('Suspensions index build failed:', err);
    process.exit(1);
  });
}
