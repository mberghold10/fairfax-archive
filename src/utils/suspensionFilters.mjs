/**
 * Filters suspension entries based on active filter criteria.
 * Exported for property-based testing (Property 9).
 *
 * @param {Array} suspensions - Array of suspension entries
 * @param {{ season?: string, team?: string, rule?: string }} filters - Active filter criteria
 * @returns {Array} Filtered suspension entries matching ALL active filters
 */
export function filterSuspensions(suspensions, filters) {
  if (!suspensions || !Array.isArray(suspensions)) return [];
  if (!filters) return suspensions;

  return suspensions.filter((entry) => {
    if (filters.season && entry.seasonName !== filters.season) return false;
    if (filters.team && entry.team.name !== filters.team) return false;
    if (filters.rule && entry.rule !== filters.rule) return false;
    return true;
  });
}
