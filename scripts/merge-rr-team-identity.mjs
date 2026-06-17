/**
 * Merge Russian Rocket team IDs into team-identity.json.
 *
 * Strategy:
 *   1. Exact name match → merge RR IDs into that canonical entry
 *   2. Fuzzy name match (Jaro-Winkler ≥ 0.88) → merge with human-readable log
 *   3. No match → create a new canonical entry (RR-only team)
 *
 * The resulting team-identity.json is still fully hand-editable.
 * Re-run at any time to pick up newly scraped RR divisions.
 *
 * Usage: node scripts/merge-rr-team-identity.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = resolve(process.cwd());
const IDENTITY_PATH = resolve(ROOT, 'archive', 'team-identity.json');
const ARCHIVE_DIR = resolve(ROOT, 'archive', 'divisions');

// ── Jaro-Winkler (copied from playerIdentity.mjs) ────────────────────────────

function jaro(s1, s2) {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  const md = Math.floor(Math.max(l1, l2) / 2) - 1;
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, l2);
    for (let j = lo; j < hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = m2[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  return (matches/l1 + matches/l2 + (matches - t/2)/matches) / 3;
}

function jaroWinkler(s1, s2) {
  const j = jaro(s1, s2);
  let p = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) p++; else break;
  }
  return j + p * 0.1 * (1 - j);
}

function normalize(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

const FUZZY_THRESHOLD = 0.92;

// ── Collect all RR team names & IDs ─────────────────────────────────────────

const rrDirs = (await readdir(ARCHIVE_DIR)).filter(d => d.startsWith('rr-'));
const rrTeams = new Map(); // name → Set<id>

for (const d of rrDirs) {
  try {
    const meta = JSON.parse(await readFile(join(ARCHIVE_DIR, d, 'meta.json'), 'utf-8'));
    for (const [id, name] of Object.entries(meta.teams || {})) {
      if (!rrTeams.has(name)) rrTeams.set(name, new Set());
      rrTeams.get(name).add(id);
    }
  } catch {}
}

console.log(`Found ${rrTeams.size} unique RR team names`);

// ── Load existing identity map ───────────────────────────────────────────────

const identity = JSON.parse(await readFile(IDENTITY_PATH, 'utf-8'));
const teams = identity.teams; // canonical name → [ids]

// Build a lookup: id → canonical name (so we don't double-add)
const idToCanonical = new Map();
for (const [canon, ids] of Object.entries(teams)) {
  for (const id of ids) idToCanonical.set(id, canon);
}

// ── Merge ────────────────────────────────────────────────────────────────────

let exactMerges = 0, fuzzyMerges = 0, newEntries = 0, alreadyMerged = 0;
const fuzzyLog = []; // for reporting

for (const [rrName, rrIds] of rrTeams) {
  // Filter to IDs not yet in the map
  const newIds = [...rrIds].filter(id => !idToCanonical.has(id));
  if (newIds.length === 0) { alreadyMerged++; continue; }

  // 1. Exact match
  if (teams[rrName]) {
    if (!DRY_RUN) {
      for (const id of newIds) {
        if (!teams[rrName].includes(id)) teams[rrName].push(id);
        idToCanonical.set(id, rrName);
      }
    }
    exactMerges++;
    continue;
  }

  // 2. Fuzzy match against existing canonicals
  const normRr = normalize(rrName);
  let bestCanon = null, bestScore = 0;
  for (const canon of Object.keys(teams)) {
    const score = jaroWinkler(normRr, normalize(canon));
    if (score >= FUZZY_THRESHOLD && score > bestScore) {
      bestScore = score; bestCanon = canon;
    }
  }

  if (bestCanon) {
    fuzzyLog.push(`  "${rrName}" → "${bestCanon}" (${bestScore.toFixed(3)})`);
    if (!DRY_RUN) {
      for (const id of newIds) {
        if (!teams[bestCanon].includes(id)) teams[bestCanon].push(id);
        idToCanonical.set(id, bestCanon);
      }
    }
    fuzzyMerges++;
    continue;
  }

  // 3. New canonical entry
  if (!DRY_RUN) {
    teams[rrName] = newIds;
    for (const id of newIds) idToCanonical.set(id, rrName);
  }
  newEntries++;
}

// Sort all IDs within each entry (RR IDs sort after numeric IDs)
if (!DRY_RUN) {
  for (const [canon, ids] of Object.entries(teams)) {
    teams[canon] = [...new Set(ids)].sort((a, b) => {
      // Numeric stiltweb IDs first (descending), then rr-t-* IDs
      const aNum = parseInt(a, 10), bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return bNum - aNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      return a.localeCompare(b);
    });
  }

  // Re-sort canonical entries alphabetically
  const sorted = Object.fromEntries(
    Object.entries(teams).sort(([a], [b]) => a.localeCompare(b))
  );
  identity.teams = sorted;
  identity._note = 'Maps canonical team names to all their historical team IDs (most recent first). Edit manually to merge teams that changed names across seasons.';

  await writeFile(IDENTITY_PATH, JSON.stringify(identity, null, 2), 'utf-8');
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log('\n=== Merge Results ===');
console.log(`Exact name matches merged: ${exactMerges}`);
console.log(`Fuzzy matches merged:      ${fuzzyMerges}`);
console.log(`New canonical entries:     ${newEntries}`);
console.log(`Already in map (skipped):  ${alreadyMerged}`);
if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
else console.log('\nWrote: archive/team-identity.json');

if (fuzzyLog.length) {
  console.log('\n=== Fuzzy merges (review these) ===');
  fuzzyLog.forEach(l => console.log(l));
}
