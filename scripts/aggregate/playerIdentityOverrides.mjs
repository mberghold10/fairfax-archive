/**
 * Player Identity Overrides
 *
 * Loads archive/player-identity.json (manually maintained, same pattern as
 * team-identity.json) and exposes helpers for applying it during name
 * clustering in playerIndex.mjs and goalieIndex.mjs.
 *
 * neverMerge: pairs of exact roster names that must not be clustered together,
 *   even if their Jaro-Winkler score clears the similarity threshold. Use this
 *   to split two different real people who happen to have similar names
 *   (e.g. "Thomas, Dylan" vs "Thomka, Wayde").
 *
 * alwaysMerge: groups of exact roster names that should be treated as the same
 *   person even if their score is too low to auto-cluster (e.g. a name typo'd
 *   very differently in one season). The first name in each group becomes the
 *   canonical display name.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeName } from '../../src/utils/playerIdentity.mjs';

let cache = null;

/**
 * @param {string} [divisionsDir] - path to archive/divisions/ (the same
 *   argument playerIndex.mjs/goalieIndex.mjs already receive as archiveDir).
 *   player-identity.json lives one level up, alongside it, at archive/.
 */
export async function loadPlayerIdentityOverrides(divisionsDir) {
  if (cache) return cache;

  const path = divisionsDir
    ? resolve(divisionsDir, '..', 'player-identity.json')
    : resolve(new URL('.', import.meta.url).pathname, '..', '..', 'archive', 'player-identity.json');

  let raw;
  try {
    raw = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    raw = { neverMerge: [], alwaysMerge: [] };
  }

  const neverMergePairs = new Set();
  for (const [a, b] of raw.neverMerge || []) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    // store both directions since lookup order isn't guaranteed
    neverMergePairs.add(`${na}|${nb}`);
    neverMergePairs.add(`${nb}|${na}`);
  }

  // Map each normalized name in an alwaysMerge group to the group's canonical
  // (first) normalized name, so clustering can force them together.
  const alwaysMergeCanonical = new Map();
  for (const group of raw.alwaysMerge || []) {
    if (!group.length) continue;
    const canonical = normalizeName(group[0]);
    for (const name of group) {
      alwaysMergeCanonical.set(normalizeName(name), canonical);
    }
  }

  cache = { neverMergePairs, alwaysMergeCanonical };
  return cache;
}

/**
 * True if two normalized names are explicitly forbidden from clustering.
 */
export function isNeverMerge(overrides, normA, normB) {
  return overrides.neverMergePairs.has(`${normA}|${normB}`);
}

/**
 * Resolve a normalized name to its forced canonical form, if any
 * (identity function if the name has no alwaysMerge override).
 */
export function resolveAlwaysMergeCanonical(overrides, norm) {
  return overrides.alwaysMergeCanonical.get(norm) || norm;
}

/**
 * Reset the module-level cache. Exposed for tests.
 */
export function _resetCache() {
  cache = null;
}
