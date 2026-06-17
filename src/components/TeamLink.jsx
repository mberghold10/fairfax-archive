import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Convert a team name to its URL slug, matching the aggregator's toTeamSlug().
 * e.g. "D 4th Liners" → "d-4th-liners"
 */
function toTeamSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Link to a team's page.
 * Uses the canonical name slug so multi-season teams resolve correctly.
 * Falls back to the raw teamId if no name is provided.
 *
 * Props:
 *   teamId - the team's numeric ID (used as fallback)
 *   name - the team's display name (used to derive slug)
 *   children - alternative to name prop
 */
export default function TeamLink({ teamId, name, children }) {
  const displayText = children || name;
  const slug = name ? toTeamSlug(name) : teamId;
  return (
    <Link to={`/teams/${slug}`} className="team-link">
      {displayText}
    </Link>
  );
}
