import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Link to a player's page.
 *
 * Props:
 *   playerId - the player's unique identifier
 *   name - display text (optional if children provided)
 *   children - alternative to name prop
 */
export default function PlayerLink({ playerId, name, children }) {
  return (
    <Link to={`/players/${playerId}`} className="player-link">
      {children || name}
    </Link>
  );
}
