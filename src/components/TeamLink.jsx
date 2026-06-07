import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Link to a team's page.
 *
 * Props:
 *   teamId - the team's unique identifier
 *   name - display text (optional if children provided)
 *   children - alternative to name prop
 */
export default function TeamLink({ teamId, name, children }) {
  return (
    <Link to={`/teams/${teamId}`} className="team-link">
      {children || name}
    </Link>
  );
}
