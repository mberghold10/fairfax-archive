/**
 * One-time helper: generates an initial team-identity.json from the season
 * catalog by grouping team IDs under their exact display name.
 *
 * Run once to bootstrap the file, then edit manually for:
 *   - Teams that changed names across seasons
 *   - Typos / alternate spellings
 *   - Merging/splitting franchises
 *
 * Usage: node scripts/generate-team-identity.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const catalog = JSON.parse(await readFile(resolve(root, 'public', 'data', 'season-catalog.json'), 'utf-8'));

const teamsByName = {};

for (const season of catalog.seasons) {
  for (const div of season.divisions) {
    for (const [id, name] of Object.entries(div.teams)) {
      if (!teamsByName[name]) teamsByName[name] = [];
      if (!teamsByName[name].includes(id)) teamsByName[name].push(id);
    }
  }
}

// Sort each team's IDs numerically descending (most recent first)
for (const ids of Object.values(teamsByName)) {
  ids.sort((a, b) => Number(b) - Number(a));
}

// Sort team names alphabetically
const sorted = Object.fromEntries(
  Object.entries(teamsByName).sort(([a], [b]) => a.localeCompare(b))
);

const output = {
  _note: "Maps canonical team names to all their historical team IDs (most recent first). Edit manually to merge teams that changed names across seasons.",
  teams: sorted,
};

await writeFile(resolve(root, 'archive', 'team-identity.json'), JSON.stringify(output, null, 2), 'utf-8');
console.log(`Written: archive/team-identity.json (${Object.keys(sorted).length} canonical teams)`);
