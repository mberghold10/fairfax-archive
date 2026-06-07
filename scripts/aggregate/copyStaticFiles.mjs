/**
 * Copy static archive files to public/data/ for serving.
 *
 * Handles two categories:
 *   1. Game sheets: archive/games/*.json → public/data/games/{gameId}.json
 *   2. Division data: archive/divisions/{divId}/*.json → public/data/divisions/{divId}/
 *
 * Uses batch processing for the ~10K game files to avoid memory issues.
 * Streams files via fs.copyFile for performance.
 *
 * Requirements: 5.1, 15.2, 15.3
 */

import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** How many files to copy concurrently in each batch */
const BATCH_SIZE = 200;

/**
 * Copy files in batches to avoid overwhelming the OS with open handles.
 * @param {Array<{src: string, dest: string}>} filePairs - source/dest pairs
 * @param {string} label - label for progress logging
 */
async function copyInBatches(filePairs, label) {
  const total = filePairs.length;
  let copied = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = filePairs.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(({ src, dest }) => copyFile(src, dest))
    );
    copied += batch.length;
    if (total > 500 && copied % 1000 === 0) {
      console.log(`    [${label}] ${copied}/${total} files copied...`);
    }
  }

  return copied;
}

/**
 * Copy all game sheet JSON files from archive/games/ to public/data/games/.
 * @param {string} archiveRoot - path to the archive/ directory
 * @param {string} outputDir - path to public/data/
 * @returns {Promise<number>} number of files copied
 */
async function copyGameFiles(archiveRoot, outputDir) {
  const gamesSource = resolve(archiveRoot, 'games');
  const gamesDest = resolve(outputDir, 'games');

  await mkdir(gamesDest, { recursive: true });

  const entries = await readdir(gamesSource);
  const jsonFiles = entries.filter(f => f.endsWith('.json'));

  const filePairs = jsonFiles.map(filename => ({
    src: join(gamesSource, filename),
    dest: join(gamesDest, filename),
  }));

  console.log(`    ${jsonFiles.length} game files to copy`);
  const count = await copyInBatches(filePairs, 'games');
  return count;
}

/**
 * Copy all division data files from archive/divisions/{divId}/ to
 * public/data/divisions/{divId}/.
 *
 * Copies: meta.json, schedule.regular.json, schedule.playoff.json,
 *         rosters.regular.json, rosters.playoff.json, suspensions.json
 *
 * @param {string} archiveRoot - path to the archive/ directory
 * @param {string} outputDir - path to public/data/
 * @returns {Promise<number>} number of files copied
 */
async function copyDivisionFiles(archiveRoot, outputDir) {
  const divisionsSource = resolve(archiveRoot, 'divisions');
  const divisionsDest = resolve(outputDir, 'divisions');

  await mkdir(divisionsDest, { recursive: true });

  const divDirs = await readdir(divisionsSource, { withFileTypes: true });
  const divFolders = divDirs.filter(d => d.isDirectory());

  let totalCopied = 0;

  // Collect all file pairs first, then batch copy
  const filePairs = [];

  for (const dir of divFolders) {
    const divId = dir.name;
    const srcDir = join(divisionsSource, divId);
    const destDir = join(divisionsDest, divId);

    await mkdir(destDir, { recursive: true });

    const files = await readdir(srcDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const filename of jsonFiles) {
      filePairs.push({
        src: join(srcDir, filename),
        dest: join(destDir, filename),
      });
    }
  }

  console.log(`    ${divFolders.length} divisions, ${filePairs.length} files to copy`);
  totalCopied = await copyInBatches(filePairs, 'divisions');
  return totalCopied;
}

/**
 * Main entry point — copies game sheets and division data files to
 * the public/data/ output directory for static serving.
 *
 * @param {string} archiveRoot - path to the archive/ directory
 * @param {string} outputDir - path to public/data/
 * @returns {Promise<{games: number, divisions: number}>} copy counts
 */
export async function copyStaticFiles(archiveRoot, outputDir) {
  const gameCount = await copyGameFiles(archiveRoot, outputDir);
  const divCount = await copyDivisionFiles(archiveRoot, outputDir);
  return { games: gameCount, divisions: divCount };
}
