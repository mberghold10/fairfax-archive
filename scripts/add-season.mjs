/**
 * Register a new season in the stiltweb scraper's KNOWN_SEASONS list.
 *
 * Usage:
 *   node scripts/add-season.mjs --div 330 --team 2000 --season "Summer 2026" --label "C"
 *
 * This updates scrape-stiltweb.mjs and then immediately scrapes the new season.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : null; };

const divId = get('--div');
const teamId = get('--team');
const seasonName = get('--season');
const divisionLabel = get('--label');

if (!divId || !teamId || !seasonName || !divisionLabel) {
  console.error('Usage: node scripts/add-season.mjs --div N --team N --season "Season Name" --label "C"');
  process.exit(1);
}

const scraperPath = resolve(process.cwd(), 'scripts', 'scrape-stiltweb.mjs');
let content = await readFile(scraperPath, 'utf-8');

// Find the KNOWN_SEASONS array and prepend the new entry
const newEntry = `  { divId: '${divId}', teamId: '${teamId}', seasonName: '${seasonName}', divisionLabel: '${divisionLabel}' },`;

content = content.replace(
  /const KNOWN_SEASONS = \[/,
  `const KNOWN_SEASONS = [\n${newEntry}`
);

await writeFile(scraperPath, content, 'utf-8');
console.log(`✓ Added ${seasonName} ${divisionLabel} (div ${divId}, team ${teamId}) to KNOWN_SEASONS`);
console.log('');
console.log('Now run the scraper to pull the new season:');
console.log(`  node scripts/scrape-stiltweb.mjs --div ${divId} --team ${teamId}`);
console.log('Then rebuild:');
console.log('  node scripts/aggregate.mjs');
