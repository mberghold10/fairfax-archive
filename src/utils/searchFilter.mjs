/**
 * Pure search filter for the Fairfax Archive search index.
 * Normalizes query, performs prefix + substring matching, and returns ranked results.
 */

/**
 * Normalize a query string: lowercase, strip punctuation (keep alphanumeric + spaces).
 * @param {string} query
 * @returns {string}
 */
export function normalizeQuery(query) {
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Filter the search index by query.
 * - Prefix matches (normalized name starts with normalized query) are ranked above substring matches.
 * - Results are unified across players and teams.
 * - Returns at most 10 results.
 *
 * @param {string} query - Raw user input
 * @param {{ players: Array<{id: string, name: string, normalized: string, type: string}>, teams: Array<{id: string, name: string, normalized: string, type: string}> }} index
 * @returns {Array<{id: string, name: string, type: string}>}
 */
export function filterSearchIndex(query, index) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const prefixMatches = [];
  const substringMatches = [];

  const allEntries = [...(index.players || []), ...(index.teams || [])];

  for (const entry of allEntries) {
    const name = entry.normalized;
    if (name.startsWith(normalized)) {
      prefixMatches.push({ id: entry.id, name: entry.name, type: entry.type });
    } else if (name.includes(normalized)) {
      substringMatches.push({ id: entry.id, name: entry.name, type: entry.type });
    }
  }

  // Prefix matches first, then substring matches, capped at 10
  return [...prefixMatches, ...substringMatches].slice(0, 10);
}
